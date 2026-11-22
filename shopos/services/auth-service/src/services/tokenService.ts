import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { exportJWK, importSPKI } from 'jose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { JwtPayload, UserRole } from '@shopos/shared-types';

// ─── Key Pair Management ────────────────────────────────────────────
//
// Horizontal scaling requirement: every auth-service replica MUST sign with
// the same private key and advertise the same `kid`, otherwise a token issued
// by replica A fails verification anywhere that cached replica B's JWKS.
//  - production: key comes from env / Vault and startup fails without it
//  - kid: derived from the public key (stable across replicas & restarts)
//  - rotation: put the old public key in JWT_PREVIOUS_PUBLIC_KEY for one
//    access-token TTL so tokens signed with it keep verifying.

interface KeyPair {
  privateKey: string;
  publicKey: string;
  kid: string;
}

interface VerifyKey {
  publicKey: string;
  kid: string;
}

const ISSUER = 'shopos-auth-service';

let keyPair: KeyPair | null = null;
let verifyKeys: VerifyKey[] = [];
let jwksCache: Promise<object> | null = null;

function normalizePem(value: string): string {
  return value.replace(/\\n/g, '\n').trim();
}

/** Stable key id: first 16 chars of base64url(SHA-256(SPKI DER)). */
export function computeKid(publicKeyPem: string): string {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('base64url').slice(0, 16);
}

export function initializeKeyPair(): KeyPair {
  if (keyPair) return keyPair;

  let privateKey: string;
  let publicKey: string;

  if (env.JWT_PRIVATE_KEY) {
    privateKey = normalizePem(env.JWT_PRIVATE_KEY);
    publicKey = env.JWT_PUBLIC_KEY
      ? normalizePem(env.JWT_PUBLIC_KEY)
      : crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
    logger.info('JWT signing key loaded from environment');
  } else {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_PRIVATE_KEY is required in production — all auth replicas must share one signing key',
      );
    }
    const generated = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = generated.privateKey;
    publicKey = generated.publicKey;
    logger.warn('JWT key pair auto-generated (development only — do not run >1 replica like this)');
  }

  keyPair = { privateKey, publicKey, kid: computeKid(publicKey) };
  verifyKeys = [{ publicKey, kid: keyPair.kid }];

  if (env.JWT_PREVIOUS_PUBLIC_KEY) {
    const prev = normalizePem(env.JWT_PREVIOUS_PUBLIC_KEY);
    verifyKeys.push({ publicKey: prev, kid: computeKid(prev) });
  }

  jwksCache = null;
  return keyPair;
}

export function getKeyPair(): KeyPair {
  if (!keyPair) {
    throw new Error('Key pair not initialized. Call initializeKeyPair() first.');
  }
  return keyPair;
}

// ─── Access Token (JWT RS256) ───────────────────────────────────────

export interface AccessTokenInput {
  sub: string;
  email: string;
  roles: UserRole[];
  permissions: string[];
}

export function signAccessToken(payload: AccessTokenInput): string {
  const kp = getKeyPair();

  return jwt.sign(
    {
      email: payload.email,
      roles: payload.roles,
      permissions: payload.permissions,
    },
    kp.privateKey,
    {
      algorithm: 'RS256',
      subject: payload.sub,
      expiresIn: env.JWT_ACCESS_TOKEN_TTL,
      issuer: ISSUER,
      keyid: kp.kid,
      // jti lets us revoke a single token with a tiny Redis key
      jwtid: crypto.randomUUID(),
    },
  );
}

export function verifyAccessToken(token: string): JwtPayload & { jti?: string } {
  getKeyPair();
  const header = jwt.decode(token, { complete: true })?.header;
  const key = verifyKeys.find((k) => k.kid === header?.kid) ?? verifyKeys[0];
  if (!key) throw new Error('No verification key configured');

  const decoded = jwt.verify(token, key.publicKey, {
    algorithms: ['RS256'],
    issuer: ISSUER,
  });

  return decoded as JwtPayload & { jti?: string };
}

/**
 * Decode token WITHOUT verification — used for blacklisting (to get exp/jti).
 */
export function decodeToken(token: string): (JwtPayload & { jti?: string }) | null {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string') return null;
  return decoded as JwtPayload & { jti?: string };
}

/** Redis key used to revoke an access token before it expires. */
export function blacklistKey(token: string, jti?: string): string {
  if (jti) return `blacklist:jti:${jti}`;
  // legacy tokens without jti: hash instead of storing the whole JWT as a key
  return `blacklist:sha:${crypto.createHash('sha256').update(token).digest('base64url')}`;
}

// ─── Refresh Token (Opaque) ─────────────────────────────────────────

export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

/** We never store raw refresh tokens in the database. */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Verification / Reset Tokens ────────────────────────────────────

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Store only a hash of email-verification / reset tokens (DB leak ≠ account takeover). */
export function hashSecureToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── JWKS Endpoint ──────────────────────────────────────────────────

export function getJWKS(): Promise<object> {
  getKeyPair();
  if (!jwksCache) {
    jwksCache = Promise.all(
      verifyKeys.map(async (k) => {
        const jwk = await exportJWK(await importSPKI(k.publicKey, 'RS256'));
        return { ...jwk, kid: k.kid, alg: 'RS256', use: 'sig' };
      }),
    ).then((keys) => ({ keys }));
  }
  return jwksCache;
}
