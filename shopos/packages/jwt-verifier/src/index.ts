import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JwtPayload } from '@shopos/shared-types';

export interface JwtVerifierOptions {
  jwksUrl: string;
  optional?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export function createJwtVerifier(options: JwtVerifierOptions) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(options.jwksUrl));
  }

  return async function jwtVerifier(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      if (options.optional) return next();
      res.status(401).json({ success: false, data: null, error: 'Unauthorized' });
      return;
    }

    try {
      const token = authHeader.slice(7);
      const { payload } = await jwtVerify(token, jwks!);
      req.user = payload as unknown as JwtPayload;
      next();
    } catch {
      res.status(401).json({ success: false, data: null, error: 'Invalid or expired token' });
    }
  };
}
