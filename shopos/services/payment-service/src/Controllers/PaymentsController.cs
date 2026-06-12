using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PaymentService.Models;
using PaymentService.Services;

namespace PaymentService.Controllers;

[ApiController]
[Route("api/v1/payments")]
public class PaymentsController : ControllerBase
{
    private readonly PaymentDbContext _db;
    private readonly StripeService _stripe;

    public PaymentsController(PaymentDbContext db, StripeService stripe)
    {
        _db = db;
        _stripe = stripe;
    }

    [HttpPost("intent")]
    public async Task<IActionResult> CreateIntent([FromBody] CreateIntentRequest req)
    {
        var amount = req.Amount > 0 ? (long)(req.Amount * 100) : 10000;
        var intent = await _stripe.CreatePaymentIntentAsync(amount, req.Currency ?? "inr");
        return Ok(new { success = true, data = new { clientSecret = intent.ClientSecret ?? intent.Id, intentId = intent.Id } });
    }

    [HttpGet("{orderId}")]
    public async Task<IActionResult> GetByOrder(string orderId)
    {
        var payment = await _db.Payments.FirstOrDefaultAsync(p => p.OrderId == orderId);
        if (payment == null) return NotFound(new { success = false, error = "Payment not found" });
        return Ok(new { success = true, data = payment });
    }
}

public class CreateIntentRequest
{
    public string OrderId { get; set; } = "";
    public decimal Amount { get; set; }
    public string? Currency { get; set; }
}
