using Stripe;

namespace PaymentService.Services
{
    /// <summary>Result of creating a payment with a provider.</summary>
    /// <param name="Status">succeeded | requires_payment_method | failed</param>
    public record GatewayIntent(string IntentId, string? ClientSecret, string Status, string? FailureReason = null);

    public interface IPaymentGateway
    {
        string Name { get; }
        Task<GatewayIntent> CreateIntentAsync(Guid orderId, decimal amount, string currency, CancellationToken ct);
        Task RefundAsync(string intentId, Guid orderId, CancellationToken ct);
    }

    /// <summary>
    /// Development gateway: every payment succeeds instantly. Selected when
    /// PAYMENT_MODE=mock (the default when no Stripe key is configured).
    /// </summary>
    public sealed class MockGateway : IPaymentGateway
    {
        public string Name => "mock";

        public Task<GatewayIntent> CreateIntentAsync(Guid orderId, decimal amount, string currency, CancellationToken ct) =>
            Task.FromResult(new GatewayIntent($"pi_mock_{orderId:N}", null, "succeeded"));

        public Task RefundAsync(string intentId, Guid orderId, CancellationToken ct) => Task.CompletedTask;
    }

    /// <summary>
    /// Stripe PaymentIntents. The customer confirms on the client with Stripe.js
    /// using the client secret; the final result arrives via the signed webhook.
    /// Idempotency keys derived from the order id make retries safe.
    /// </summary>
    public sealed class StripeGateway : IPaymentGateway
    {
        private readonly PaymentIntentService _intents;
        private readonly RefundService _refunds;

        public StripeGateway(string secretKey)
        {
            var client = new StripeClient(secretKey);
            _intents = new PaymentIntentService(client);
            _refunds = new RefundService(client);
        }

        public string Name => "stripe";

        public async Task<GatewayIntent> CreateIntentAsync(Guid orderId, decimal amount, string currency, CancellationToken ct)
        {
            var options = new PaymentIntentCreateOptions
            {
                // Smallest currency unit (paise for INR)
                Amount = (long)Math.Round(amount * 100m, MidpointRounding.AwayFromZero),
                Currency = currency.ToLowerInvariant(),
                AutomaticPaymentMethods = new PaymentIntentAutomaticPaymentMethodsOptions { Enabled = true },
                Metadata = new Dictionary<string, string> { ["orderId"] = orderId.ToString() },
            };
            var intent = await _intents.CreateAsync(options, new RequestOptions { IdempotencyKey = $"pi-{orderId}" }, ct);
            var status = intent.Status == "succeeded" ? "succeeded" : "requires_payment_method";
            return new GatewayIntent(intent.Id, intent.ClientSecret, status);
        }

        public async Task RefundAsync(string intentId, Guid orderId, CancellationToken ct)
        {
            await _refunds.CreateAsync(
                new RefundCreateOptions { PaymentIntent = intentId },
                new RequestOptions { IdempotencyKey = $"rf-{orderId}" },
                ct);
        }
    }
}
