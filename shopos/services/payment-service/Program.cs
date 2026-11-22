using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PaymentService.Kafka;
using PaymentService.Models;
using PaymentService.Services;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

builder.Host.ConfigureHostOptions(o => o.ShutdownTimeout = TimeSpan.FromSeconds(25));
builder.Logging.AddJsonConsole();

// ─── Database ────────────────────────────────────────────────────────
// Pool size lives in the connection string (e.g. "Maximum Pool Size=30").
var connectionString = config.GetConnectionString("DefaultConnection")
    ?? "Host=localhost;Database=shopos_db;Username=shopos_admin;Password=shopos_password;Maximum Pool Size=30";
builder.Services.AddDbContextPool<PaymentDbContext>(o => o.UseNpgsql(connectionString), poolSize: 256);

// ─── Payment provider ────────────────────────────────────────────────
var stripeKey = config["STRIPE_SECRET_KEY"];
var paymentMode = config["PAYMENT_MODE"]
    ?? (string.IsNullOrEmpty(stripeKey) || stripeKey.Contains("mock") ? "mock" : "stripe");
if (paymentMode == "stripe")
{
    if (string.IsNullOrEmpty(stripeKey)) throw new InvalidOperationException("PAYMENT_MODE=stripe requires STRIPE_SECRET_KEY");
    builder.Services.AddSingleton<IPaymentGateway>(new StripeGateway(stripeKey));
}
else
{
    if (builder.Environment.IsProduction() && config["ALLOW_MOCK_PAYMENTS"] != "true")
    {
        throw new InvalidOperationException("Mock payments are disabled in production (set PAYMENT_MODE=stripe)");
    }
    builder.Services.AddSingleton<IPaymentGateway, MockGateway>();
}

builder.Services.AddSingleton(new EventPublisher(config["KAFKA_BROKERS"] ?? "localhost:9092"));
builder.Services.AddScoped<PaymentProcessor>();
builder.Services.AddHostedService<SagaConsumer>();

// ─── Auth: JWT verified locally against cached auth-service JWKS ─────
builder.Services.AddHttpClient();
builder.Services.AddSingleton(sp => new JwksCache(
    sp.GetRequiredService<IHttpClientFactory>().CreateClient(),
    config["AUTH_JWKS_URL"] ?? "http://localhost:3001/.well-known/jwks.json",
    sp.GetRequiredService<ILogger<JwksCache>>()));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<JwksCache>((o, jwks) =>
    {
        o.MapInboundClaims = false; // keep "sub" and "roles" as-is
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = "shopos-auth-service",
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidAlgorithms = new[] { SecurityAlgorithms.RsaSha256 },
            ClockSkew = TimeSpan.FromSeconds(30),
            IssuerSigningKeyResolver = (_, _, kid, _) => jwks.GetKeys(kid),
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddControllers();

var app = builder.Build();

var shuttingDown = false;
app.Lifetime.ApplicationStopping.Register(() => shuttingDown = true);

app.MapGet("/health", () => Results.Ok(new { success = true, data = new { status = "ok", service = "payment-service", mode = paymentMode } }));
app.MapGet("/ready", async (PaymentDbContext db, CancellationToken ct) =>
{
    if (shuttingDown) return Results.Json(new { ready = false, reason = "shutting_down" }, statusCode: 503);
    var ok = await db.Database.CanConnectAsync(ct);
    return ok
        ? Results.Ok(new { ready = true, service = "payment-service" })
        : Results.Json(new { ready = false, service = "payment-service" }, statusCode: 503);
});
app.MapGet("/metrics", () => Results.Text(
    "# HELP shopos_up Service is running\n# TYPE shopos_up gauge\nshopos_up{service=\"payment-service\"} 1\n",
    "text/plain; version=0.0.4"));

app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
