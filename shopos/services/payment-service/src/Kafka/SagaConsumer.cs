using System.Text.Json;
using Confluent.Kafka;
using PaymentService.Services;

namespace PaymentService.Kafka
{
    /// <summary>
    /// Consumes payment commands from the order saga with at-least-once semantics:
    /// the offset is committed only after the command was handled (or parked on a DLQ).
    /// </summary>
    public sealed class SagaConsumer : BackgroundService
    {
        private static readonly string[] Topics = { "payment.initiate", "payment.refund_requested" };

        private readonly IServiceScopeFactory _scopes;
        private readonly EventPublisher _events;
        private readonly ILogger<SagaConsumer> _log;
        private readonly string _brokers;

        public SagaConsumer(IServiceScopeFactory scopes, EventPublisher events, ILogger<SagaConsumer> log, IConfiguration config)
        {
            _scopes = scopes;
            _events = events;
            _log = log;
            _brokers = config["KAFKA_BROKERS"] ?? "localhost:9092";
        }

        // Consume() blocks; run the loop on its own thread so host startup isn't blocked.
        protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
            Task.Run(() => RunAsync(stoppingToken), stoppingToken);

        private async Task RunAsync(CancellationToken ct)
        {
            var config = new ConsumerConfig
            {
                BootstrapServers = _brokers,
                GroupId = "payment-saga-group",
                AutoOffsetReset = AutoOffsetReset.Earliest,
                EnableAutoCommit = false,
                SessionTimeoutMs = 30000,
            };

            using var consumer = new ConsumerBuilder<string, string>(config).Build();
            consumer.Subscribe(Topics);
            _log.LogInformation("Payment saga consumer subscribed to {Topics}", string.Join(",", Topics));

            try
            {
                while (!ct.IsCancellationRequested)
                {
                    ConsumeResult<string, string>? result;
                    try
                    {
                        result = consumer.Consume(ct);
                    }
                    catch (ConsumeException ex)
                    {
                        _log.LogWarning("Kafka consume error: {Reason}", ex.Error.Reason);
                        continue;
                    }
                    if (result?.Message == null) continue;

                    if (!await HandleWithRetryAsync(result, ct))
                    {
                        break; // shutting down: don't commit, the message will be redelivered
                    }
                    consumer.Commit(result);
                }
            }
            catch (OperationCanceledException)
            {
                // normal shutdown
            }
            finally
            {
                consumer.Close();
            }
        }

        private async Task<bool> HandleWithRetryAsync(ConsumeResult<string, string> result, CancellationToken ct)
        {
            var delay = TimeSpan.FromMilliseconds(200);
            for (var attempt = 1; attempt <= 5; attempt++)
            {
                try
                {
                    await HandleAsync(result.Topic, result.Message.Value, ct);
                    return true;
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    return false;
                }
                catch (Exception ex)
                {
                    _log.LogWarning("Handling {Topic} failed (attempt {Attempt}): {Message}", result.Topic, attempt, ex.Message);
                    try { await Task.Delay(delay, ct); } catch (OperationCanceledException) { return false; }
                    delay *= 2;
                }
            }

            _log.LogError("Parking message from {Topic} on DLQ after repeated failures", result.Topic);
            using var dlq = new ProducerBuilder<string, string>(new ProducerConfig { BootstrapServers = _brokers }).Build();
            await dlq.ProduceAsync(result.Topic + ".dlq", new Message<string, string> { Key = result.Message.Key, Value = result.Message.Value }, ct);
            return true;
        }

        private async Task HandleAsync(string topic, string raw, CancellationToken ct)
        {
            JsonElement payload;
            try
            {
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                payload = (root.TryGetProperty("payload", out var p) && p.ValueKind == JsonValueKind.Object ? p : root).Clone();
            }
            catch (JsonException)
            {
                _log.LogWarning("Unparseable message on {Topic}; skipping", topic);
                return;
            }

            if (!payload.TryGetProperty("orderId", out var oid) || !Guid.TryParse(oid.GetString(), out var orderId))
            {
                _log.LogWarning("Message on {Topic} without a valid orderId; skipping", topic);
                return;
            }

            using var scope = _scopes.CreateScope();
            var processor = scope.ServiceProvider.GetRequiredService<PaymentProcessor>();

            if (topic == "payment.refund_requested")
            {
                await processor.HandleRefundAsync(orderId, ct);
                return;
            }

            // payment.initiate: amount/currency come from the order service, which
            // priced the order server-side. Never from the client.
            var amount = payload.TryGetProperty("amount", out var a) && a.ValueKind == JsonValueKind.Number ? a.GetDecimal() : 0m;
            var currency = payload.TryGetProperty("currency", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString()!.Trim() : "INR";
            var userId = payload.TryGetProperty("userId", out var u) && u.ValueKind == JsonValueKind.String ? u.GetString() : null;

            await processor.HandleInitiateAsync(orderId, userId, amount, currency, ct);
        }
    }
}
