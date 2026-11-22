import type { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../config/redis.js';
import { sendError } from '../utils/apiResponse.js';

interface RateLimitOptions {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyPrefix?: string;    // Redis key prefix
}

// Fixed-window counter in a single atomic round trip.
// O(1) memory per client (one integer key) instead of one sorted-set member
// per request — this matters when millions of clients are being tracked.
const RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

/**
 * Identify the caller: authenticated user id when available (fair for users
 * behind carrier-grade NAT sharing one IP), otherwise client IP.
 */
function clientKey(req: Request): string {
  const userId = req.user?.sub;
  if (userId) return `u:${userId}`;
  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

export function rateLimiter(options: RateLimitOptions) {
  const { windowMs, maxRequests, keyPrefix = 'rl' } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const redis = getRedisClient();
      const key = `${keyPrefix}:${clientKey(req)}`;
      const result = (await redis.eval(RATE_LIMIT_LUA, 1, key, String(windowMs))) as [number, number];
      const count = Number(result[0]);
      const ttlMs = Math.max(0, Number(result[1]));

      res.set({
        'X-RateLimit-Limit': String(maxRequests),
        'X-RateLimit-Remaining': String(Math.max(0, maxRequests - count)),
        'X-RateLimit-Reset': String(Math.ceil(ttlMs / 1000)),
      });

      if (count > maxRequests) {
        res.set('Retry-After', String(Math.ceil(ttlMs / 1000)));
        sendError(res, 'Too many requests. Please try again later.', 429);
        return;
      }

      next();
    } catch {
      // Fail open: if Redis is unavailable the gateway-level limit still applies.
      next();
    }
  };
}
