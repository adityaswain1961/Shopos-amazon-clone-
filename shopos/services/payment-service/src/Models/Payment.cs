using Microsoft.EntityFrameworkCore;

namespace PaymentService.Models
{
    public class PaymentDbContext : DbContext
    {
        public PaymentDbContext(DbContextOptions<PaymentDbContext> options) : base(options) { }

        public DbSet<Payment> Payments { get; set; }
    }

    public class Payment
    {
        public Guid Id { get; set; }
        public string OrderId { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public string Currency { get; set; } = "INR";
        public string Status { get; set; } = "PENDING"; // PENDING, COMPLETED, FAILED, REFUNDED
        public string StripePaymentIntentId { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? CompletedAt { get; set; }
    }
}
