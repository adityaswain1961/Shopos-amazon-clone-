import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { exportJWK, importSPKI } from 'jose';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { JwtPayload, UserRole } from '@shopos/shared-types';

// ─── Key Pair Management ────────────────────────────────────────────

interface KeyPair {
  privateKey: string;
  publicKey: string;
  kid: string;
}

let keyPair: KeyPair | null = null;

/**
 * Initialize the RSA key pair for JWT signing.
 * In production, loads from env vars. In dev, auto-generates.
 */
export function initializeKeyPair(): KeyPair {
  if (keyPair) return keyPair;

  if (env.JWT_PRIVATE_KEY && env.JWT_PUBLIC_KEY) {
    // Production: load from environment (PEM-encoded, with \n replaced)
    keyPair = {
      privateKey: env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'),
      publicKey: env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'),
      kid: uuidv4(),
    };
    logger.info('JWT key pair loaded from environment variables');
  } else {
    // Development: auto-generate
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    keyPair = { privateKey, publicKey, kid: uuidv4() };
    logger.info('JWT RS256 key pair auto-generated (development mode)');
  }

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
      issuer: 'shopos-auth-service',
      keyid: kp.kid,
    },
  );
}

export function verifyAccessToken(token: string): JwtPayload {
  const kp = getKeyPair();

  const decoded = jwt.verify(token, kp.publicKey, {
    algorithms: ['RS256'],
    issuer: 'shopos-auth-service',
  });

  return decoded as JwtPayload;
}

/**
 * Decode token WITHOUT verification — used for blacklisting (to get exp).
 */
export function decodeToken(token: string): JwtPayload | null {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string') return null;
  return decoded as JwtPayload;
}

// ─── Refresh Token (Opaque) ─────────────────────────────────────────

/**
 * Generate a cryptographically random opaque refresh token (64 bytes hex).
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Hash a refresh token for storage (SHA-256).
 * We never store raw refresh tokens in the database.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Verification / Reset Tokens ────────────────────────────────────

/**
 * Generate a random token for email verification or password reset.
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ─── JWKS Endpoint ──────────────────────────────────────────────────

export async function getJWKS(): Promise<object> {
  const kp = getKeyPair();

  // Import the PEM public key and export as JWK
  const publicKeyObj = await importSPKI(kp.publicKey, 'RS256');
  const jwk = await exportJWK(publicKeyObj);

  return {
    keys: [
      {
        ...jwk,
        kid: kp.kid,
        alg: 'RS256',
        use: 'sig',
      },
    ],
  };
}
