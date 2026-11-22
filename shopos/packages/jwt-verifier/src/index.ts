import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTVerifyGetKey, type KeyLike } from 'jose';
import type { JwtPayload } from '@shopos/shared-types';

/**
 * Stateless JWT verification for every Node service.
 *
 * Tokens are verified locally against the auth-service public key (fetched
 * once from JWKS and cached in memory), so auth-service is NOT called per
 * request — this is what lets the other services scale independently.
 */

export interface JwtVerifierOptions {
  jwksUrl: string;
  /** Optional static PEM (tests / air-gapped dev) — takes precedence over JWKS. */
  publicKeyPem?: string;
  issuer?: string;
  /** If true, requests without a token pass through anonymously. */
  optional?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const keyResolvers = new Map<string, JWTVerifyGetKey>();
let staticKey: Promise<KeyLike> | null = null;

function resolver(options: JwtVerifierOptions): JWTVerifyGetKey | Promise<KeyLike> {
  if (options.publicKeyPem) {
    if (!staticKey) staticKey = importSPKI(options.publicKeyPem.replace(/\\n/g, '\n'), 'RS256');
    return staticKey;
  }
  let jwks = keyResolvers.get(options.jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(options.jwksUrl), {
      cacheMaxAge: 10 * 60 * 1000, // re-fetch keys at most every 10 minutes
      cooldownDuration: 30 * 1000, // unknown kid → at most one refetch per 30s
      timeoutDuration: 3000,
    });
    keyResolvers.set(options.jwksUrl, jwks);
  }
  return jwks;
}

export async function verifyJwt(token: string, options: JwtVerifierOptions): Promise<JwtPayload> {
  const key = resolver(options);
  const verifyOpts = { issuer: options.issuer ?? 'shopos-auth-service', algorithms: ['RS256'] };
  const { payload } =
    typeof key === 'function'
      ? await jwtVerify(token, key, verifyOpts)
      : await jwtVerify(token, await key, verifyOpts);

  return {
    sub: String(payload.sub),
    email: String(payload['email'] ?? ''),
    roles: (payload['roles'] as JwtPayload['roles']) ?? [],
    permissions: (payload['permissions'] as string[]) ?? [],
    iat: Number(payload.iat),
    exp: Number(payload.exp),
  };
}

export function createJwtVerifier(options: JwtVerifierOptions) {
  return async function jwtVerifier(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      if (options.optional) return next();
      res.status(401).json({ success: false, data: null, error: 'Authentication required' });
      return;
    }

    try {
      req.user = await verifyJwt(authHeader.slice(7), options);
      next();
    } catch {
      if (options.optional) return next();
      res.status(401).json({ success: false, data: null, error: 'Invalid or expired token' });
    }
  };
}

export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, data: null, error: 'Authentication required' });
      return;
    }
    if (!req.user.roles.some((r) => roles.includes(r))) {
      res.status(403).json({ success: false, data: null, error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
