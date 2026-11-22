using System.Text.Json;
using Confluent.Kafka;

namespace PaymentService.Services
{
    /// <summary>One long-lived idempotent producer per process, shared by the consumer and webhooks.</summary>
    public sealed class EventPublisher : IDisposable
    {
        private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        private readonly IProducer<string, string> _producer;

        public EventPublisher(string brokers)
        {
            _producer = new ProducerBuilder<string, string>(new ProducerConfig
            {
                BootstrapServers = brokers,
                EnableIdempotence = true,
                Acks = Acks.All,
                LingerMs = 5,
                CompressionType = CompressionType.Gzip, // kafkajs consumers only support gzip natively
            }).Build();
        }

        /// <summary>Publishes the standard ShopOS envelope, keyed by order id (keeps per-order ordering).</summary>
        public async Task PublishAsync(string topic, Guid orderId, object payload, CancellationToken ct = default)
        {
            var envelope = new Dictionary<string, object?>
            {
                ["eventId"] = Guid.NewGuid().ToString(),
                ["type"] = topic,
                ["timestamp"] = DateTime.UtcNow.ToString("O"),
                ["version"] = "1.0",
                ["payload"] = payload,
            };
            await _producer.ProduceAsync(
                topic,
                new Message<string, string> { Key = orderId.ToString(), Value = JsonSerializer.Serialize(envelope, Json) },
                ct);
        }

        public void Dispose()
        {
            _producer.Flush(TimeSpan.FromSeconds(5));
            _producer.Dispose();
        }
    }
}
