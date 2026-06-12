import type { Request, Response, NextFunction } from 'express';
import * as tokenService from '../services/tokenService.js';
import { getRedisClient } from '../config/redis.js';
import { sendError } from '../utils/apiResponse.js';
import type { JwtPayload } from '@shopos/shared-types';

// Extend Express Request to include user
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
 * Verifies Bearer token, checks Redis blacklist, attaches user to request.
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'Authentication required', 401);
    return;
  }

  const token = authHeader.substring(7);

  // Check Redis blacklist
  const redis = getRedisClient();
  redis
    .get(`blacklist:${token}`)
    .then((blacklisted) => {
      if (blacklisted) {
        sendError(res, 'Token has been revoked', 401);
        return;
      }

      try {
        const decoded = tokenService.verifyAccessToken(token);
        req.user = decoded;
        next();
      } catch {
        sendError(res, 'Invalid or expired token', 401);
      }
    })
    .catch(() => {
      // If Redis is down, still verify the JWT (graceful degradation)
      try {
        const decoded = tokenService.verifyAccessToken(token);
        req.user = decoded;
        next();
      } catch {
        sendError(res, 'Invalid or expired token', 401);
      }
    });
}

/**
 * Role-based access control middleware.
 * Must be used after authMiddleware.
 */
export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const hasRole = req.user.roles.some((role) => roles.includes(role));
    if (!hasRole) {
      sendError(res, 'Insufficient permissions', 403);
      return;
    }

    next();
  };
}
