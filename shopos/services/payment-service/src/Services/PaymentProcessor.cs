using Microsoft.EntityFrameworkCore;
using Npgsql;
using PaymentService.Models;

namespace PaymentService.Services
{
    /// <summary>
    /// Payment state machine shared by the Kafka saga consumer and the webhook.
    /// Idempotent: UNIQUE(order_id) guarantees at most one payment per order, and
    /// a redelivered command re-publishes the outcome instead of charging again.
    /// </summary>
    public sealed class PaymentProcessor
    {
        private readonly PaymentDbContext _db;
        private readonly IPaymentGateway _gateway;
        private readonly EventPublisher _events;
        private readonly ILogger<PaymentProcessor> _log;

        public PaymentProcessor(PaymentDbContext db, IPaymentGateway gateway, EventPublisher events, ILogger<PaymentProcessor> log)
        {
            _db = db;
            _gateway = gateway;
            _events = events;
            _log = log;
        }

        public async Task HandleInitiateAsync(Guid orderId, string? userId, decimal amount, string currency, CancellationToken ct)
        {
            var existing = await _db.Payments.FirstOrDefaultAsync(p => p.OrderId == orderId, ct);
            if (existing != null)
            {
                await RepublishOutcomeAsync(existing, ct);
                return;
            }

            if (amount <= 0 || amount > 10_000_000m || currency.Length != 3)
            {
                await _events.PublishAsync("payment.failed", orderId, new { orderId, reason = "invalid_amount" }, ct);
                return;
            }

            GatewayIntent intent;
            try
            {
                intent = await _gateway.CreateIntentAsync(orderId, amount, currency, ct);
            }
            catch (Stripe.StripeException ex)
            {
                _log.LogWarning("Stripe rejected payment for order {OrderId}: {Message}", orderId, ex.Message);
                intent = new GatewayIntent($"failed_{orderId:N}", null, PaymentStatus.Failed, ex.StripeError?.Code ?? "provider_error");
            }

            var payment = new Payment
            {
                Id = Guid.NewGuid(),
                OrderId = orderId,
                UserId = userId,
                Amount = amount,
                Currency = currency.ToUpperInvariant(),
                Provider = _gateway.Name,
                ProviderIntentId = intent.IntentId,
                ClientSecret = intent.ClientSecret,
                Status = intent.Status,
                FailureReason = intent.FailureReason,
            };
            _db.Payments.Add(payment);
            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                // Another replica processed the same command concurrently.
                _db.ChangeTracker.Clear();
                var winner = await _db.Payments.AsNoTracking().FirstAsync(p => p.OrderId == orderId, ct);
                await RepublishOutcomeAsync(winner, ct);
                return;
            }

            await RepublishOutcomeAsync(payment, ct);
        }

        /// <summary>Called from the Stripe webhook with the provider's final status.</summary>
        public async Task HandleProviderResultAsync(string intentId, bool succeeded, string? failureReason, CancellationToken ct)
        {
            var payment = await _db.Payments.FirstOrDefaultAsync(p => p.ProviderIntentId == intentId, ct);
            if (payment == null)
            {
                _log.LogWarning("Webhook for unknown payment intent {IntentId}", intentId);
                return;
            }
            // Ignore stale/duplicate webhooks once a terminal state is reached.
            if (payment.Status is PaymentStatus.Succeeded or PaymentStatus.Refunded)
            {
                return;
            }

            payment.Status = succeeded ? PaymentStatus.Succeeded : PaymentStatus.Failed;
            payment.FailureReason = succeeded ? null : failureReason;
            payment.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await RepublishOutcomeAsync(payment, ct);
        }

        public async Task HandleRefundAsync(Guid orderId, CancellationToken ct)
        {
            var payment = await _db.Payments.FirstOrDefaultAsync(p => p.OrderId == orderId, ct);
            if (payment == null || payment.Status != PaymentStatus.Succeeded || payment.ProviderIntentId == null)
            {
                return;
            }
            await _gateway.RefundAsync(payment.ProviderIntentId, orderId, ct);
            payment.Status = PaymentStatus.Refunded;
            payment.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await _events.PublishAsync("payment.refunded", orderId, new { orderId, amount = payment.Amount, currency = payment.Currency }, ct);
            _log.LogInformation("Refunded payment for order {OrderId}", orderId);
        }

        private Task RepublishOutcomeAsync(Payment p, CancellationToken ct) => p.Status switch
        {
            PaymentStatus.Succeeded => _events.PublishAsync("payment.completed", p.OrderId,
                new { orderId = p.OrderId, paymentId = p.Id, amount = p.Amount, currency = p.Currency }, ct),
            PaymentStatus.Failed => _events.PublishAsync("payment.failed", p.OrderId,
                new { orderId = p.OrderId, reason = p.FailureReason ?? "payment_failed" }, ct),
            // still waiting for the customer / webhook: nothing to announce yet
            _ => Task.CompletedTask,
        };
    }
}
