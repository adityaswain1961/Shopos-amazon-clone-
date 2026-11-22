jest.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test', PORT: 3001,
    MONGO_URI: 'mongodb://localhost:27017/test', REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY: '', JWT_PUBLIC_KEY: '',
    JWT_ACCESS_TOKEN_TTL: 900, JWT_REFRESH_TOKEN_TTL: 604800,
    RESEND_API_KEY: '', EMAIL_FROM: 'test@shopos.dev',
    SMTP_HOST: 'localhost', SMTP_PORT: 1025, SMTP_USER: '', SMTP_PASS: '',
    KAFKA_BROKERS: 'localhost:9092', KAFKA_CLIENT_ID: 'auth-test',
    FRONTEND_URL: 'http://localhost:3000',
    RATE_LIMIT_WINDOW_MS: 60000, RATE_LIMIT_MAX_REQUESTS: 100,
    BCRYPT_ROUNDS: 10, MONGO_MAX_POOL_SIZE: 5, JWT_PREVIOUS_PUBLIC_KEY: '',
    LOG_LEVEL: 'error', ACCESS_LOG: false,
  },
}));

const mockRedisGet = jest.fn().mockResolvedValue(null);
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisPipeline = jest.fn().mockReturnValue({
  zremrangebyscore: jest.fn().mockReturnThis(),
  zadd: jest.fn().mockReturnThis(),
  zcard: jest.fn().mockReturnThis(),
  pexpire: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([[null,0],[null,1],[null,1],[null,1]]),
});

jest.mock('../config/redis', () => ({
  getRedisClient: () => ({ get: mockRedisGet, set: mockRedisSet, pipeline: mockRedisPipeline }),
  connectRedis: jest.fn().mockResolvedValue(undefined),
  disconnectRedis: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../config/kafka', () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined),
  connectKafka: jest.fn().mockResolvedValue(undefined),
  disconnectKafka: jest.fn().mockResolvedValue(undefined),
  getKafkaProducer: jest.fn(),
}));

jest.mock('../services/emailService', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../config/db', () => ({
  connectDatabase: jest.fn().mockResolvedValue(undefined),
  disconnectDatabase: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { app } from '../app';
import { initializeKeyPair, signAccessToken, hashRefreshToken } from '../services/tokenService';
import { UserAuth } from '../models/UserAuth';
import { RefreshToken } from '../models/RefreshToken';
import { Session } from '../models/Session';
import * as emailService from '../services/emailService';
import { publishEvent } from '../config/kafka';
import type { UserRole } from '@shopos/shared-types';

beforeAll(() => { initializeKeyPair(); });

describe('POST /api/v1/auth/register', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('should register a new user successfully', async () => {
    jest.spyOn(UserAuth, 'exists').mockResolvedValue(null);
    jest.spyOn(UserAuth, 'create').mockResolvedValue({
      _id: new mongoose.Types.ObjectId(), email: 'newuser@example.com',
      roles: ['customer'], permissions: [], isEmailVerified: false,
      createdAt: new Date(), toJSON() { return this; },
    } as any);

    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'newuser@example.com', password: 'SecureP@ss1', name: 'Test User',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('newuser@example.com');
    expect(emailService.sendVerificationEmail).toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalledWith('user.registered', expect.objectContaining({ type: 'user.registered' }), expect.any(String));
  });

  it('should return 409 for duplicate email', async () => {
    jest.spyOn(UserAuth, 'exists').mockResolvedValue({ _id: new mongoose.Types.ObjectId() } as any);
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'x@x.com', password: 'SecureP@ss1', name: 'Dup',
    });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('should return 409 when a concurrent registration wins the race', async () => {
    jest.spyOn(UserAuth, 'exists').mockResolvedValue(null);
    jest.spyOn(UserAuth, 'create').mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'race@x.com', password: 'SecureP@ss1', name: 'Race',
    });
    expect(res.status).toBe(409);
  });

  it('should return 400 for invalid input', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'bad', password: 'sh', name: 'A',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Validation error');
  });

  it('should return 400 for weak password', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'v@e.com', password: 'NoSpecial1', name: 'Test User',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('special character');
  });
});

describe('POST /api/v1/auth/login', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  let passwordHash: string;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => { passwordHash = await bcrypt.hash('SecureP@ss1', 10); });

  it('should login successfully', async () => {
    jest.spyOn(UserAuth, 'findOne').mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: userId, email: 'login@example.com', passwordHash,
        roles: ['customer'], permissions: [], isEmailVerified: true,
        failedLoginAttempts: 0, lockoutUntil: null,
      }),
    } as any);
    jest.spyOn(UserAuth, 'updateOne').mockResolvedValue({} as any);
    jest.spyOn(RefreshToken, 'create').mockResolvedValue({} as any);
    jest.spyOn(Session, 'findOneAndUpdate').mockResolvedValue({} as any);

    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'login@example.com', password: 'SecureP@ss1',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.tokens.accessToken).toBeDefined();
    expect(res.body.data.tokens.refreshToken).toBeDefined();
  });

  it('should return 401 for wrong password', async () => {
    jest.spyOn(UserAuth, 'findOne').mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: userId, email: 'l@e.com', passwordHash,
        roles: ['customer'], permissions: [], failedLoginAttempts: 0, lockoutUntil: null,
      }),
    } as any);
    const inc = jest.spyOn(UserAuth, 'findOneAndUpdate').mockResolvedValue({ failedLoginAttempts: 1 } as any);
    jest.spyOn(UserAuth, 'updateOne').mockResolvedValue({} as any);

    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'l@e.com', password: 'WrongP@ss1!',
    });
    expect(inc).toHaveBeenCalledWith(expect.anything(), { $inc: { failedLoginAttempts: 1 } }, expect.anything());
    expect(res.status).toBe(401);
  });

  it('should restart the failed-attempt count once a lockout has expired', async () => {
    jest.spyOn(UserAuth, 'findOne').mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: userId, email: 'l@e.com', passwordHash,
        roles: ['customer'], permissions: [], failedLoginAttempts: 5,
        lockoutUntil: new Date(Date.now() - 60_000), // expired a minute ago
      }),
    } as any);
    const upd = jest.spyOn(UserAuth, 'findOneAndUpdate').mockResolvedValue({ failedLoginAttempts: 1 } as any);
    const relock = jest.spyOn(UserAuth, 'updateOne').mockResolvedValue({} as any);

    const res = await request(app).post('/api/v1/auth/login').send({ email: 'l@e.com', password: 'WrongP@ss1!' });
    expect(res.status).toBe(401);
    expect(upd).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { failedLoginAttempts: 1, lockoutUntil: null } },
      expect.anything(),
    );
    expect(relock).not.toHaveBeenCalled(); // one typo after a lockout must not re-lock
  });

  it('should return 401 for non-existent user', async () => {
    jest.spyOn(UserAuth, 'findOne').mockReturnValue({ select: jest.fn().mockResolvedValue(null) } as any);
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'g@e.com', password: 'P@ss1234' });
    expect(res.status).toBe(401);
  });

  it('should return 423 for locked account', async () => {
    jest.spyOn(UserAuth, 'findOne').mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: userId, email: 'l@e.com', passwordHash,
        lockoutUntil: new Date(Date.now() + 1800000),
        failedLoginAttempts: 5,
      }),
    } as any);
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'l@e.com', password: 'P@ss1234' });
    expect(res.status).toBe(423);
  });
});

describe('POST /api/v1/auth/logout', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('should logout with valid token', async () => {
    const token = signAccessToken({ sub: 'u1', email: 'l@e.com', roles: ['customer' as UserRole], permissions: [] });
    jest.spyOn(RefreshToken, 'updateOne').mockResolvedValue({} as any);
    const res = await request(app).post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`).send({ refreshToken: 'rt' });
    expect(res.status).toBe(200);
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it('should return 401 without auth', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({});
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('should refresh tokens', async () => {
    const uid = new mongoose.Types.ObjectId();
    const raw = 'valid-rt';
    const claim = jest.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValue({
      _id: new mongoose.Types.ObjectId(), userId: uid, tokenHash: hashRefreshToken(raw),
      family: 'fam', deviceInfo: { ua: 't', ip: '1' },
      expiresAt: new Date(Date.now() + 604800000), revokedAt: null,
    } as any);
    jest.spyOn(UserAuth, 'findById').mockResolvedValue({
      _id: uid, email: 'r@e.com', roles: ['customer'], permissions: [],
    } as any);
    jest.spyOn(RefreshToken, 'create').mockResolvedValue({} as any);

    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: raw });
    expect(res.status).toBe(200);
    expect(res.body.data.tokens.accessToken).toBeDefined();
    // the claim must be atomic and conditional on the token still being live
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: hashRefreshToken(raw), revokedAt: null }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('should return 409 (not revoke the family) for a concurrent refresh within the grace window', async () => {
    jest.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValue(null);
    jest.spyOn(RefreshToken, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        userId: new mongoose.Types.ObjectId(), family: 'fam', revokedAt: new Date(),
      }),
    } as any);
    const revoke = jest.spyOn(RefreshToken, 'updateMany').mockResolvedValue({} as any);
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'just-rotated' });
    expect(res.status).toBe(409);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('should return 403 on token reuse', async () => {
    jest.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValue(null);
    jest.spyOn(RefreshToken, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        userId: new mongoose.Types.ObjectId(), family: 'fam', revokedAt: new Date(Date.now() - 60_000),
      }),
    } as any);
    jest.spyOn(RefreshToken, 'updateMany').mockResolvedValue({} as any);
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'reused' });
    expect(res.status).toBe(403);
  });

  it('should return 401 for expired token', async () => {
    jest.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValue(null);
    jest.spyOn(RefreshToken, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        userId: new mongoose.Types.ObjectId(), family: 'fam', expiresAt: new Date(Date.now() - 1000), revokedAt: null,
      }),
    } as any);
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'exp' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/auth/verify-email', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('should verify with valid token', async () => {
    const upd = jest.spyOn(UserAuth, 'findOneAndUpdate').mockResolvedValue({ _id: new mongoose.Types.ObjectId() } as any);
    const res = await request(app).get('/api/v1/auth/verify-email').query({ token: 'valid' });
    expect(res.status).toBe(200);
    // only a hash of the token is ever stored / queried
    expect(JSON.stringify(upd.mock.calls[0]?.[0])).not.toContain('"valid"');
  });

  it('should return 400 for invalid token', async () => {
    jest.spyOn(UserAuth, 'findOneAndUpdate').mockResolvedValue(null);
    const res = await request(app).get('/api/v1/auth/verify-email').query({ token: 'bad' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/forgot-password', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('should always return 200', async () => {
    jest.spyOn(UserAuth, 'findOne').mockResolvedValue(null);
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'x@x.com' });
    expect(res.status).toBe(200);
  });

  it('should send reset email for existing user', async () => {
    const m = { email: 'e@e.com', save: jest.fn().mockResolvedValue(undefined), resetPasswordToken: null, resetPasswordExpiry: null };
    jest.spyOn(UserAuth, 'findOne').mockResolvedValue(m as any);
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'e@e.com' });
    expect(res.status).toBe(200);
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/reset-password', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('should reset password', async () => {
    const m = { _id: new mongoose.Types.ObjectId(), save: jest.fn().mockResolvedValue(undefined), passwordHash: 'old', resetPasswordToken: null, resetPasswordExpiry: null, failedLoginAttempts: 0, lockoutUntil: null };
    jest.spyOn(UserAuth, 'findOne').mockResolvedValue(m as any);
    jest.spyOn(RefreshToken, 'updateMany').mockResolvedValue({} as any);
    const res = await request(app).post('/api/v1/auth/reset-password').send({ token: 'valid', password: 'NewP@ss123' });
    expect(res.status).toBe(200);
    expect(m.save).toHaveBeenCalled();
  });

  it('should return 400 for invalid token', async () => {
    jest.spyOn(UserAuth, 'findOne').mockResolvedValue(null);
    const res = await request(app).post('/api/v1/auth/reset-password').send({ token: 'bad', password: 'NewP@ss123' });
    expect(res.status).toBe(400);
  });

  it('should return 400 for weak password', async () => {
    const res = await request(app).post('/api/v1/auth/reset-password').send({ token: 'x', password: 'weak' });
    expect(res.status).toBe(400);
  });
});

describe('GET /.well-known/jwks.json', () => {
  it('should return JWKS', async () => {
    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    // raw RFC 7517 document, no { success, data } envelope
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0].kty).toBe('RSA');
    expect(res.body.keys[0].alg).toBe('RS256');
    expect(res.body.keys[0].kid).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});

describe('GET /health', () => {
  it('should return ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });
});

describe('404', () => {
  it('should return 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/auth/nonexistent');
    expect(res.status).toBe(404);
  });
});
