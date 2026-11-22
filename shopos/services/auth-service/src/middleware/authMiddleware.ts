import type { Request, Response, NextFunction } from 'express';
import * as tokenService from '../services/tokenService.js';
import { getRedisClient } from '../config/redis.js';
import { sendError } from '../utils/apiResponse.js';
import type { JwtPayload } from '@shopos/shared-types';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      correlationId?: string;
    }
  }
}

/**
 * JWT authentication middleware.
 * Verifies the signature first (pure CPU, no I/O), then checks the Redis
 * revocation list by `jti`. If Redis is down we degrade to signature-only.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'Authentication required', 401);
    return;
  }

  const token = authHeader.substring(7);
  let decoded: ReturnType<typeof tokenService.verifyAccessToken>;
  try {
    decoded = tokenService.verifyAccessToken(token);
  } catch {
    sendError(res, 'Invalid or expired token', 401);
    return;
  }

  try {
    const revoked = await getRedisClient().get(tokenService.blacklistKey(token, decoded.jti));
    if (revoked) {
      sendError(res, 'Token has been revoked', 401);
      return;
    }
  } catch {
    // Redis unavailable — accept the (still signature-valid, short-lived) token.
  }

  req.user = decoded;
  next();
}

export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }
    if (!req.user.roles.some((role) => roles.includes(role))) {
      sendError(res, 'Insufficient permissions', 403);
      return;
    }
    next();
  };
}
