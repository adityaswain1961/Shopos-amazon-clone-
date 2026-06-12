import type { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../config/redis.js';
import { sendError } from '../utils/apiResponse.js';

interface RateLimitOptions {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyPrefix?: string;    // Redis key prefix
}

/**
 * Redis-based sliding window rate limiter.
 * Uses sorted sets for precise sliding window counting.
 */
export function rateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    maxRequests,
    keyPrefix = 'rl',
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const redis = getRedisClient();
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `${keyPrefix}:${req.path}:${clientIp}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Use a Redis pipeline for atomicity
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart); // Remove expired entries
      pipeline.zadd(key, now.toString(), `${now}-${Math.random()}`); // Add current request
      pipeline.zcard(key);                              // Count requests in window
      pipeline.pexpire(key, windowMs);                  // Set TTL on the key

      const results = await pipeline.exec();
      const requestCount = results?.[2]?.[1] as number || 0;

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': Math.max(0, maxRequests - requestCount).toString(),
        'X-RateLimit-Reset': new Date(now + windowMs).toISOString(),
      });

      if (requestCount > maxRequests) {
        sendError(res, 'Too many requests. Please try again later.', 429);
        return;
      }

      next();
    } catch {
      // If Redis is down, allow the request (graceful degradation)
      next();
    }
  };
}
