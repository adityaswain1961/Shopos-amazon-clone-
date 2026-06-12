using Stripe;

namespace PaymentService.Services
{
    public class StripeService
    {
        public StripeService()
        {
            StripeConfiguration.ApiKey = Environment.GetEnvironmentVariable("STRIPE_SECRET_KEY") ?? "sk_test_mock";
        }

        public async Task<PaymentIntent> CreatePaymentIntentAsync(long amount, string currency)
        {
            if (StripeConfiguration.ApiKey == "sk_test_mock")
            {
                // Return a mock object if using mock key
                Console.WriteLine($"[Mock Stripe] Creating PaymentIntent for {amount} {currency}");
                return new PaymentIntent { Id = "pi_mock_" + Guid.NewGuid().ToString(), Status = "requires_payment_method" };
            }

            var options = new PaymentIntentCreateOptions
            {
                Amount = amount,
                Currency = currency,
                PaymentMethodTypes = new List<string> { "card" },
            };

            var service = new PaymentIntentService();
            return await service.CreateAsync(options);
        }

        public async Task<PaymentIntent> ConfirmPaymentIntentAsync(string paymentIntentId)
        {
            if (StripeConfiguration.ApiKey == "sk_test_mock")
            {
                Console.WriteLine($"[Mock Stripe] Confirming PaymentIntent {paymentIntentId}");
                return new PaymentIntent { Id = paymentIntentId, Status = "succeeded" };
            }

            var service = new PaymentIntentService();
            // In a real flow, the client confirms it, but we can simulate confirmation for API-based testing
            var options = new PaymentIntentConfirmOptions { PaymentMethod = "pm_card_visa" };
            return await service.ConfirmAsync(paymentIntentId, options);
        }
    }
}
