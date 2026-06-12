import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify, importSPKI, type KeyLike, type JWTVerifyGetKey } from 'jose';
import { env } from '../config/env.js';
import { sendError } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';
import type { JwtPayload } from '@shopos/shared-types';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      correlationId?: string;
    }
  }
}

let jwks: JWTVerifyGetKey | null = null;
let localPublicKey: KeyLike | null = null;

async function verifyToken(token: string) {
  if (env.JWT_PUBLIC_KEY) {
    if (!localPublicKey) {
      const pem = env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
      localPublicKey = await importSPKI(pem, 'RS256');
    }
    return jwtVerify(token, localPublicKey, {
      issuer: 'shopos-auth-service',
      algorithms: ['RS256'],
    });
  }

  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(env.AUTH_JWKS_URL));
  }
  return jwtVerify(token, jwks, {
    issuer: 'shopos-auth-service',
    algorithms: ['RS256'],
  });
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'Authentication required', 401);
    return;
  }

  const token = authHeader.substring(7);

  try {
    const { payload } = await verifyToken(token);

    req.user = {
      sub: payload.sub as string,
      email: payload['email'] as string,
      roles: payload['roles'] as JwtPayload['roles'],
      permissions: payload['permissions'] as string[],
      iat: payload.iat as number,
      exp: payload.exp as number,
    };

    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown';
    logger.debug('JWT verification failed', { error: message });
    sendError(res, 'Invalid or expired token', 401);
  }
}

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
