using Microsoft.EntityFrameworkCore;

namespace PaymentService.Models
{
    public class PaymentDbContext : DbContext
    {
        public PaymentDbContext(DbContextOptions<PaymentDbContext> options) : base(options) { }

        public DbSet<Payment> Payments => Set<Payment>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            // Maps onto the shared `payments` table from infrastructure/db/init.sql
            // (snake_case columns, one row per order enforced by UNIQUE(order_id)).
            modelBuilder.Entity<Payment>(e =>
            {
                e.ToTable("payments");
                e.HasKey(x => x.Id);
                e.Property(x => x.Id).HasColumnName("id");
                e.Property(x => x.OrderId).HasColumnName("order_id");
                e.Property(x => x.UserId).HasColumnName("user_id");
                e.Property(x => x.Amount).HasColumnName("amount").HasColumnType("numeric(12,2)");
                e.Property(x => x.Currency).HasColumnName("currency");
                e.Property(x => x.Status).HasColumnName("status");
                e.Property(x => x.Provider).HasColumnName("provider");
                e.Property(x => x.ProviderIntentId).HasColumnName("provider_intent_id");
                e.Property(x => x.ClientSecret).HasColumnName("client_secret");
                e.Property(x => x.FailureReason).HasColumnName("failure_reason");
                e.Property(x => x.CreatedAt).HasColumnName("created_at");
                e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
                e.HasIndex(x => x.OrderId).IsUnique();
                e.HasIndex(x => x.ProviderIntentId).IsUnique();
            });
        }
    }

    public static class PaymentStatus
    {
        public const string Pending = "pending";
        public const string RequiresPaymentMethod = "requires_payment_method";
        public const string Succeeded = "succeeded";
        public const string Failed = "failed";
        public const string Refunded = "refunded";
    }

    public class Payment
    {
        public Guid Id { get; set; }
        public Guid OrderId { get; set; }
        public string? UserId { get; set; }
        public decimal Amount { get; set; }
        public string Currency { get; set; } = "INR";
        public string Status { get; set; } = PaymentStatus.Pending;
        public string Provider { get; set; } = "mock";
        public string? ProviderIntentId { get; set; }
        public string? ClientSecret { get; set; }
        public string? FailureReason { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
