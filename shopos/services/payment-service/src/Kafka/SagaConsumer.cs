using Confluent.Kafka;
using Microsoft.Extensions.Hosting;
using System.Text.Json;
using PaymentService.Models;
using PaymentService.Services;
using Microsoft.Extensions.DependencyInjection;

namespace PaymentService.Kafka
{
    public class SagaConsumer : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly StripeService _stripeService;

        public SagaConsumer(IServiceProvider serviceProvider, StripeService stripeService)
        {
            _serviceProvider = serviceProvider;
            _stripeService = stripeService;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var config = new ConsumerConfig
            {
                BootstrapServers = Environment.GetEnvironmentVariable("KAFKA_BROKERS") ?? "localhost:9092",
                GroupId = "payment-saga-group",
                AutoOffsetReset = AutoOffsetReset.Earliest
            };

            using var consumer = new ConsumerBuilder<Ignore, string>(config).Build();
            consumer.Subscribe("payment.initiate");

            var producerConfig = new ProducerConfig { BootstrapServers = config.BootstrapServers };
            using var producer = new ProducerBuilder<Null, string>(producerConfig).Build();

            Console.WriteLine("SAGA: Payment Service listening for payment.initiate...");

            try
            {
                while (!stoppingToken.IsCancellationRequested)
                {
                    var consumeResult = consumer.Consume(stoppingToken);
                    Console.WriteLine($"SAGA: Received payment request: {consumeResult.Message.Value}");

                    // Process Payment
                    bool success = await ProcessPayment(consumeResult.Message.Value);

                    // Publish Result
                    var topic = success ? "payment.completed" : "payment.failed";
                    await producer.ProduceAsync(topic, new Message<Null, string> { Value = consumeResult.Message.Value });
                    Console.WriteLine($"SAGA: Published {topic}");
                }
            }
            catch (OperationCanceledException)
            {
                consumer.Close();
            }
        }

        private async Task<bool> ProcessPayment(string payload)
        {
            using var scope = _serviceProvider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();

            // Mock payload parsing
            try
            {
                var doc = JsonDocument.Parse(payload);
                var root = doc.RootElement;
                if (root.TryGetProperty("payload", out var envelope))
                    root = envelope;
                string orderId = root.TryGetProperty("orderId", out var oid)
                    ? oid.GetString() ?? Guid.NewGuid().ToString()
                    : Guid.NewGuid().ToString();
                
                // 1. Create Payment Intent
                var intent = await _stripeService.CreatePaymentIntentAsync(10000, "inr"); // Mock amount: 100.00 INR

                // 2. Confirm Payment Intent
                var confirmedIntent = await _stripeService.ConfirmPaymentIntentAsync(intent.Id);

                // 3. Save to DB Ledger
                var payment = new Payment
                {
                    Id = Guid.NewGuid(),
                    OrderId = orderId,
                    Amount = 100.00m,
                    StripePaymentIntentId = confirmedIntent.Id,
                    Status = confirmedIntent.Status == "succeeded" ? "COMPLETED" : "FAILED",
                    CompletedAt = DateTime.UtcNow
                };

                db.Payments.Add(payment);
                await db.SaveChangesAsync();

                return payment.Status == "COMPLETED";
            }
            catch (Exception ex)
            {
                Console.WriteLine($"SAGA ERROR: {ex.Message}");
                return false;
            }
        }
    }
}
