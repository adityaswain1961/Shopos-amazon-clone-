using Microsoft.EntityFrameworkCore;
using PaymentService.Models;
using PaymentService.Services;
using PaymentService.Kafka;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();

// Database setup
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
    ?? "Host=localhost;Database=shopos_payments;Username=postgres;Password=postgres";
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseNpgsql(connectionString));

// Stripe Service
builder.Services.AddSingleton<StripeService>();

// Kafka Background Service
builder.Services.AddHostedService<SagaConsumer>();

var app = builder.Build();

app.MapGet("/health", () => new { Status = "ok", Service = "payment-service" });
app.MapGet("/ready", () => new { ready = true, Service = "payment-service" });
app.MapGet("/metrics", () => Results.Text(
    "# HELP shopos_up Service is running\nshopos_up{service=\"payment-service\"} 1\n",
    "text/plain; version=0.0.4"));

app.MapControllers();

app.Run();
