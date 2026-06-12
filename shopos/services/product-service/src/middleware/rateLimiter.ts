import type { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../config/redis.js';
import { sendError } from '../utils/apiResponse.js';

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export function rateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    maxRequests,
    keyPrefix = 'rl:products',
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const redis = getRedisClient();
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `${keyPrefix}:${req.path}:${clientIp}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now.toString(), `${now}-${Math.random()}`);
      pipeline.zcard(key);
      pipeline.pexpire(key, windowMs);

      const results = await pipeline.exec();
      const requestCount = results?.[2]?.[1] as number || 0;

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
      next();
    }
  };
}
