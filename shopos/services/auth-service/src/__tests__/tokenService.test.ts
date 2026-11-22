jest.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_PRIVATE_KEY: '',
    JWT_PUBLIC_KEY: '',
    JWT_ACCESS_TOKEN_TTL: 900,
    JWT_REFRESH_TOKEN_TTL: 604800,
    JWT_PREVIOUS_PUBLIC_KEY: '',
    LOG_LEVEL: 'error',
  },
}));

import {
  initializeKeyPair, signAccessToken, verifyAccessToken,
  decodeToken, generateRefreshToken, hashRefreshToken,
  generateSecureToken, getJWKS, computeKid, getKeyPair,
} from '../services/tokenService';
import type { UserRole } from '@shopos/shared-types';

describe('TokenService', () => {
  beforeAll(() => { initializeKeyPair(); });

  describe('initializeKeyPair', () => {
    it('should generate an RSA key pair', () => {
      const kp = initializeKeyPair();
      expect(kp.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
      expect(kp.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
      expect(typeof kp.kid).toBe('string');
    });
  });

  describe('signAccessToken', () => {
    it('should produce a valid JWT string', () => {
      const token = signAccessToken({
        sub: 'user-123', email: 'test@example.com',
        roles: ['customer' as UserRole], permissions: ['product:read'],
      });
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include correct claims', () => {
      const token = signAccessToken({
        sub: 'user-456', email: 'admin@example.com',
        roles: ['admin' as UserRole], permissions: ['product:write', 'order:read'],
      });
      const decoded = verifyAccessToken(token);
      expect(decoded.sub).toBe('user-456');
      expect(decoded.email).toBe('admin@example.com');
      expect(decoded.roles).toEqual(['admin']);
      expect(decoded.permissions).toEqual(['product:write', 'order:read']);
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify a valid token', () => {
      const token = signAccessToken({
        sub: 'user-789', email: 'v@example.com',
        roles: ['customer' as UserRole], permissions: [],
      });
      expect(verifyAccessToken(token).sub).toBe('user-789');
    });

    it('should reject a tampered token', () => {
      const token = signAccessToken({
        sub: 'u', email: 't@e.com', roles: ['customer' as UserRole], permissions: [],
      });
      const parts = token.split('.');
      parts[1] = parts[1] + 'x';
      expect(() => verifyAccessToken(parts.join('.'))).toThrow();
    });
  });

  describe('decodeToken', () => {
    it('should decode without verification', () => {
      const token = signAccessToken({
        sub: 'user-d', email: 'd@e.com', roles: ['seller' as UserRole], permissions: [],
      });
      expect(decodeToken(token)!.sub).toBe('user-d');
    });

    it('should return null for invalid token', () => {
      expect(decodeToken('not-a-jwt')).toBeNull();
    });
  });

  describe('generateRefreshToken', () => {
    it('should return a 128-char hex string', () => {
      const t = generateRefreshToken();
      expect(t).toHaveLength(128);
      expect(/^[0-9a-f]+$/.test(t)).toBe(true);
    });
    it('should generate unique tokens', () => {
      expect(generateRefreshToken()).not.toBe(generateRefreshToken());
    });
  });

  describe('hashRefreshToken', () => {
    it('should produce consistent SHA-256 hash', () => {
      expect(hashRefreshToken('test')).toBe(hashRefreshToken('test'));
      expect(hashRefreshToken('test')).toHaveLength(64);
    });
    it('should differ for different inputs', () => {
      expect(hashRefreshToken('a')).not.toBe(hashRefreshToken('b'));
    });
  });

  describe('generateSecureToken', () => {
    it('should return a 64-char hex string', () => {
      const t = generateSecureToken();
      expect(t).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(t)).toBe(true);
    });
  });

  describe('getJWKS', () => {
    it('should return valid JWKS', async () => {
      const jwks = await getJWKS() as { keys: Record<string, unknown>[] };
      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0].kty).toBe('RSA');
      expect(jwks.keys[0].alg).toBe('RS256');
      expect(jwks.keys[0].use).toBe('sig');
      expect(jwks.keys[0].n).toBeDefined();
      expect(jwks.keys[0].e).toBeDefined();
    });
  });

  describe('horizontal scaling', () => {
    it('derives a deterministic kid from the public key (same on every replica)', () => {
      const { publicKey, kid } = getKeyPair();
      expect(computeKid(publicKey)).toBe(kid);
      expect(computeKid(publicKey)).toBe(computeKid(publicKey));
    });

    it('issues a unique jti per access token (used for revocation)', () => {
      const input = { sub: 'u', email: 'j@e.com', roles: ['customer' as UserRole], permissions: [] };
      const a = decodeToken(signAccessToken(input))!;
      const b = decodeToken(signAccessToken(input))!;
      expect(a.jti).toBeDefined();
      expect(a.jti).not.toBe(b.jti);
    });
  });
});
