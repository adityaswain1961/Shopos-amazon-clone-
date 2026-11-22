using Microsoft.IdentityModel.Tokens;

namespace PaymentService.Services
{
    /// <summary>
    /// Caches the auth-service JWK Set so JWT validation is local (no network call per request).
    /// Refreshes every 10 minutes, or (rate-limited) when an unknown key id shows up after a rotation.
    /// </summary>
    public sealed class JwksCache
    {
        private static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(10);
        private static readonly TimeSpan UnknownKidCooldown = TimeSpan.FromSeconds(30);

        private readonly HttpClient _http;
        private readonly string _url;
        private readonly ILogger<JwksCache> _log;
        private readonly SemaphoreSlim _refreshLock = new(1, 1);
        private volatile IList<SecurityKey> _keys = new List<SecurityKey>();
        private DateTime _fetchedAt = DateTime.MinValue;

        public JwksCache(HttpClient http, string url, ILogger<JwksCache> log)
        {
            _http = http;
            _url = url;
            _log = log;
        }

        public IEnumerable<SecurityKey> GetKeys(string? kid)
        {
            var age = DateTime.UtcNow - _fetchedAt;
            var unknownKid = kid != null && !_keys.Any(k => k.KeyId == kid);
            if (age > MaxAge || (unknownKid && age > UnknownKidCooldown))
            {
                Refresh();
            }
            return _keys;
        }

        private void Refresh()
        {
            if (!_refreshLock.Wait(0))
            {
                return; // another request is already refreshing; use current keys
            }
            try
            {
                var json = _http.GetStringAsync(_url).GetAwaiter().GetResult();
                _keys = new JsonWebKeySet(json).GetSigningKeys();
                _fetchedAt = DateTime.UtcNow;
            }
            catch (Exception ex)
            {
                _log.LogWarning("JWKS refresh failed, keeping cached keys: {Message}", ex.Message);
                _fetchedAt = DateTime.UtcNow - MaxAge + UnknownKidCooldown; // back off before retrying
            }
            finally
            {
                _refreshLock.Release();
            }
        }
    }
}
