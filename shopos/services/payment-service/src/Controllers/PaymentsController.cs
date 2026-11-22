using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PaymentService.Models;
using PaymentService.Services;
using Stripe;

namespace PaymentService.Controllers;

[ApiController]
[Route("api/v1/payments")]
public class PaymentsController : ControllerBase
{
    private static readonly string[] StaffRoles = { "admin", "super_admin", "support" };

    private readonly PaymentDbContext _db;
    private readonly PaymentProcessor _processor;
    private readonly IConfiguration _config;
    private readonly ILogger<PaymentsController> _log;

    public PaymentsController(PaymentDbContext db, PaymentProcessor processor, IConfiguration config, ILogger<PaymentsController> log)
    {
        _db = db;
        _processor = processor;
        _config = config;
        _log = log;
    }

    /// <summary>
    /// Payment status for an order (the checkout page polls this). While the
    /// payment awaits the customer it also returns the Stripe client secret,
    /// which the frontend passes to Stripe.js to confirm the payment.
    /// </summary>
    [Authorize]
    [HttpGet("{orderId:guid}")]
    public async Task<IActionResult> GetByOrder(Guid orderId, CancellationToken ct)
    {
        var payment = await _db.Payments.AsNoTracking().FirstOrDefaultAsync(p => p.OrderId == orderId, ct);
        var sub = User.FindFirst("sub")?.Value;
        var isStaff = User.FindAll("roles").Any(r => StaffRoles.Contains(r.Value));

        if (payment == null || (payment.UserId != sub && !isStaff))
        {
            // 404 rather than 403 so other users' order ids can't be probed
            return NotFound(new { success = false, data = (object?)null, error = "Payment not found" });
        }

        var awaitingCustomer = payment.Status == PaymentStatus.RequiresPaymentMethod;
        Response.Headers.CacheControl = "private, no-store";
        return Ok(new
        {
            success = true,
            error = (string?)null,
            data = new
            {
                orderId = payment.OrderId,
                status = payment.Status,
                amount = payment.Amount,
                currency = payment.Currency,
                provider = payment.Provider,
                clientSecret = awaitingCustomer ? payment.ClientSecret : null,
                publishableKey = awaitingCustomer ? _config["STRIPE_PUBLISHABLE_KEY"] : null,
            },
        });
    }

    /// <summary>
    /// Stripe webhook (configure in the Stripe dashboard → /api/v1/payments/webhooks/stripe).
    /// The signature is verified with STRIPE_WEBHOOK_SECRET; unsigned calls are rejected.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("webhooks/stripe")]
    public async Task<IActionResult> StripeWebhook(CancellationToken ct)
    {
        var secret = _config["STRIPE_WEBHOOK_SECRET"];
        if (string.IsNullOrEmpty(secret))
        {
            return NotFound();
        }

        string json;
        using (var reader = new StreamReader(Request.Body))
        {
            json = await reader.ReadToEndAsync(ct);
        }

        Event stripeEvent;
        try
        {
            stripeEvent = EventUtility.ConstructEvent(
                json, Request.Headers["Stripe-Signature"], secret, throwOnApiVersionMismatch: false);
        }
        catch (StripeException ex)
        {
            _log.LogWarning("Rejected Stripe webhook: {Message}", ex.Message);
            return BadRequest();
        }

        if (stripeEvent.Data.Object is PaymentIntent intent)
        {
            switch (stripeEvent.Type)
            {
                case "payment_intent.succeeded":
                    await _processor.HandleProviderResultAsync(intent.Id, true, null, ct);
                    break;
                case "payment_intent.payment_failed":
                case "payment_intent.canceled":
                    await _processor.HandleProviderResultAsync(
                        intent.Id, false, intent.LastPaymentError?.Code ?? stripeEvent.Type, ct);
                    break;
            }
        }

        return Ok();
    }
}
