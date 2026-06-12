// ─── Mock Environment ───────────────────────────────────────────────
jest.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test', PORT: 3002,
    MONGO_URI: 'mongodb://localhost:27017/test', REDIS_URL: 'redis://localhost:6379',
    AUTH_JWKS_URL: 'http://localhost:3001/.well-known/jwks.json',
    JWT_PUBLIC_KEY: '',
    AWS_S3_BUCKET: 'test-bucket', AWS_S3_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test',
    CDN_BASE_URL: 'https://cdn.test.com',
    KAFKA_BROKERS: 'localhost:9092', KAFKA_CLIENT_ID: 'user-test',
    FRONTEND_URL: 'http://localhost:3000',
    RATE_LIMIT_WINDOW_MS: 60000, RATE_LIMIT_MAX_REQUESTS: 100,
  },
}));

// ─── Mock Redis ─────────────────────────────────────────────────────
const mockRedisGet = jest.fn().mockResolvedValue(null);
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);
const mockRedisPipeline = jest.fn().mockReturnValue({
  zremrangebyscore: jest.fn().mockReturnThis(),
  zadd: jest.fn().mockReturnThis(),
  zcard: jest.fn().mockReturnThis(),
  pexpire: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([[null, 0], [null, 1], [null, 1], [null, 1]]),
});

jest.mock('../config/redis', () => ({
  getRedisClient: () => ({
    get: mockRedisGet, set: mockRedisSet, del: mockRedisDel, pipeline: mockRedisPipeline,
  }),
  connectRedis: jest.fn().mockResolvedValue(undefined),
  disconnectRedis: jest.fn().mockResolvedValue(undefined),
}));

// ─── Mock Kafka ─────────────────────────────────────────────────────
jest.mock('../config/kafka', () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined),
  connectKafka: jest.fn().mockResolvedValue(undefined),
  disconnectKafka: jest.fn().mockResolvedValue(undefined),
  getKafkaProducer: jest.fn(),
}));

// ─── Mock S3 ────────────────────────────────────────────────────────
jest.mock('../config/s3', () => ({
  getS3Client: jest.fn(),
  uploadToS3: jest.fn().mockResolvedValue('https://cdn.test.com/avatars/test-user.webp'),
}));

// ─── Mock Sharp ─────────────────────────────────────────────────────
jest.mock('sharp', () => {
  const sharpInstance = {
    resize: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed-image')),
  };
  return jest.fn(() => sharpInstance);
});

// ─── Mock Archiver ──────────────────────────────────────────────────
jest.mock('archiver', () => {
  return jest.fn(() => {
    let pipedRes: any = null;
    return {
      pipe: jest.fn((res: any) => { pipedRes = res; }),
      append: jest.fn(),
      finalize: jest.fn().mockImplementation(() => {
        // Simulate the archive finishing by ending the piped response
        if (pipedRes && typeof pipedRes.end === 'function') {
          pipedRes.end();
        }
        return Promise.resolve();
      }),
    };
  });
});

// ─── Mock DB ────────────────────────────────────────────────────────
jest.mock('../config/db', () => ({
  connectDatabase: jest.fn().mockResolvedValue(undefined),
  disconnectDatabase: jest.fn().mockResolvedValue(undefined),
}));

// ─── Mock Auth Middleware ───────────────────────────────────────────
jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      sub: 'test-user-id',
      email: 'test@shopos.dev',
      roles: ['customer'],
      permissions: [],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    };
    next();
  },
  requireRoles: () => (_req: any, _res: any, next: any) => next(),
}));

// ─── Imports ────────────────────────────────────────────────────────
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app';
import { UserProfile } from '../models/UserProfile';
import { Address } from '../models/Address';
import { Wishlist } from '../models/Wishlist';
import { RecentlyViewed } from '../models/RecentlyViewed';
import { SearchHistory } from '../models/SearchHistory';
import { publishEvent } from '../config/kafka';

// ═════════════════════════════════════════════════════════════════════
// GET /health
// ═════════════════════════════════════════════════════════════════════
describe('GET /health', () => {
  it('should return ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.service).toBe('user-service');
  });
});

// ═════════════════════════════════════════════════════════════════════
// 404
// ═════════════════════════════════════════════════════════════════════
describe('404', () => {
  it('should return 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/users/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════
// PROFILE
// ═════════════════════════════════════════════════════════════════════
describe('GET /api/v1/users/me', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('should return profile (auto-create on first access)', async () => {
    jest.spyOn(UserProfile, 'findOne').mockResolvedValue(null);
    jest.spyOn(UserProfile, 'create').mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      userId: 'test-user-id',
      displayName: '',
      bio: '',
      phone: '',
      dateOfBirth: null,
      avatarUrl: '',
      language: 'en',
      currency: 'INR',
      profilePublic: true,
      completionPercent: 0,
      notificationPrefs: { email: true, sms: true, push: true, promotions: false },
      isDeleted: false,
      deletedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON() { return this; },
    } as any);

    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.userId).toBe('test-user-id');
  });

  it('should return cached profile from Redis', async () => {
    const cached = JSON.stringify({
      userId: 'test-user-id', displayName: 'Cached User', completionPercent: 50,
    });
    mockRedisGet.mockResolvedValueOnce(cached);

    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(200);
    expect(res.body.data.profile.displayName).toBe('Cached User');
  });
});

describe('PATCH /api/v1/users/me', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('should update profile fields', async () => {
    const mockProfile = {
      _id: new mongoose.Types.ObjectId(),
      userId: 'test-user-id',
      displayName: 'Old Name',
      bio: '',
      phone: '',
      dateOfBirth: null,
      avatarUrl: '',
      language: 'en',
      currency: 'INR',
      profilePublic: true,
      completionPercent: 0,
      notificationPrefs: { email: true, sms: true, push: true, promotions: false },
      isDeleted: false,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON() { return this; },
    };
    jest.spyOn(UserProfile, 'findOne').mockResolvedValue(mockProfile as any);

    const res = await request(app).patch('/api/v1/users/me').send({
      displayName: 'New Name',
      bio: 'Hello ShopOS',
    });

    expect(res.status).toBe(200);
    expect(mockProfile.save).toHaveBeenCalled();
    expect(mockProfile.displayName).toBe('New Name');
    expect(mockProfile.bio).toBe('Hello ShopOS');
    expect(publishEvent).toHaveBeenCalledWith('user.profile_updated',
      expect.objectContaining({ type: 'user.profile_updated' }));
  });

  it('should return 400 for invalid input', async () => {
    const res = await request(app).patch('/api/v1/users/me').send({
      displayName: 'A', // too short — min 2
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Validation error');
  });

  it('should reject unknown fields (strict mode)', async () => {
    const res = await request(app).patch('/api/v1/users/me').send({
      unknownField: 'malicious',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/users/me/avatar', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('should upload and process avatar', async () => {
    jest.spyOn(UserProfile, 'findOne').mockResolvedValue({
      userId: 'test-user-id', avatarUrl: '', save: jest.fn().mockResolvedValue(undefined),
      isDeleted: false,
    } as any);

    const res = await request(app)
      .post('/api/v1/users/me/avatar')
      .attach('avatar', Buffer.from('fake-image'), {
        filename: 'avatar.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.avatarUrl).toContain('cdn.test.com');
  });

  it('should return 400 without file', async () => {
    const res = await request(app).post('/api/v1/users/me/avatar');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No avatar file provided');
  });
});

describe('DELETE /api/v1/users/me', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('should soft-delete account', async () => {
    const mockProfile = {
      userId: 'test-user-id', isDeleted: false, deletedAt: null,
      displayName: 'User', bio: 'Bio', phone: '1234', dateOfBirth: new Date(),
      avatarUrl: 'http://url', save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(UserProfile, 'findOne').mockResolvedValue(mockProfile as any);

    const res = await request(app).delete('/api/v1/users/me');
    expect(res.status).toBe(200);
    expect(mockProfile.isDeleted).toBe(true);
    expect(mockProfile.displayName).toBe('[Deleted User]');
    expect(publishEvent).toHaveBeenCalledWith('user.account_deleted',
      expect.objectContaining({ type: 'user.account_deleted' }));
  });
});

describe('GET /api/v1/users/me/export', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('should export user data', async () => {
    jest.spyOn(UserProfile, 'findOne').mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ userId: 'test' }) }),
    } as any);
    jest.spyOn(Address, 'find').mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    } as any);
    jest.spyOn(Wishlist, 'find').mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    } as any);
    jest.spyOn(RecentlyViewed, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) }),
    } as any);
    jest.spyOn(SearchHistory, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) }),
    } as any);

    const res = await request(app).get('/api/v1/users/me/export');
    // archiver is mocked, so response won't be a real zip, but we verify 200
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════
// ADDRESSES
// ═════════════════════════════════════════════════════════════════════
describe('Address CRUD', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  const validAddress = {
    label: 'home',
    fullName: 'Test User',
    phone: '+919876543210',
    line1: '123 Main Street',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    postalCode: '400001',
  };

  it('GET /me/addresses should list addresses', async () => {
    jest.spyOn(Address, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      }),
    } as any);

    const res = await request(app).get('/api/v1/users/me/addresses');
    expect(res.status).toBe(200);
    expect(res.body.data.addresses).toEqual([]);
  });

  it('POST /me/addresses should create address', async () => {
    jest.spyOn(Address, 'countDocuments').mockResolvedValue(0);
    jest.spyOn(Address, 'create').mockResolvedValue({
      _id: new mongoose.Types.ObjectId(), userId: 'test-user-id', ...validAddress,
      isDefaultShipping: false, isDefaultBilling: false,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON() { return this; },
    } as any);

    const res = await request(app).post('/api/v1/users/me/addresses').send(validAddress);
    expect(res.status).toBe(201);
    expect(res.body.data.address.fullName).toBe('Test User');
  });

  it('POST /me/addresses should reject when max 10 reached', async () => {
    jest.spyOn(Address, 'countDocuments').mockResolvedValue(10);

    const res = await request(app).post('/api/v1/users/me/addresses').send(validAddress);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Maximum');
  });

  it('POST /me/addresses should reject invalid input', async () => {
    const res = await request(app).post('/api/v1/users/me/addresses').send({
      label: 'invalid',
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /me/addresses/:id should update address', async () => {
    const addrId = new mongoose.Types.ObjectId().toString();
    jest.spyOn(Address, 'findOneAndUpdate').mockResolvedValue({
      _id: addrId, fullName: 'Updated Name',
      toJSON() { return this; },
    } as any);

    const res = await request(app)
      .patch(`/api/v1/users/me/addresses/${addrId}`)
      .send({ fullName: 'Updated Name' });
    expect(res.status).toBe(200);
  });

  it('DELETE /me/addresses/:id should delete address', async () => {
    const addrId = new mongoose.Types.ObjectId().toString();
    jest.spyOn(Address, 'findOneAndDelete').mockResolvedValue({
      _id: addrId, isDefaultShipping: false, isDefaultBilling: false,
    } as any);

    const res = await request(app).delete(`/api/v1/users/me/addresses/${addrId}`);
    expect(res.status).toBe(200);
  });

  it('PATCH /me/addresses/:id/default should set default', async () => {
    const addrId = new mongoose.Types.ObjectId().toString();
    jest.spyOn(Address, 'findOne').mockResolvedValue({
      _id: addrId, isDefaultShipping: false,
      save: jest.fn().mockResolvedValue(undefined),
    } as any);
    jest.spyOn(Address, 'updateMany').mockResolvedValue({} as any);

    const res = await request(app)
      .patch(`/api/v1/users/me/addresses/${addrId}/default`)
      .send({ type: 'shipping' });
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════
// WISHLISTS
// ═════════════════════════════════════════════════════════════════════
describe('Wishlist CRUD', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('GET /me/wishlists should list wishlists', async () => {
    jest.spyOn(Wishlist, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      }),
    } as any);

    const res = await request(app).get('/api/v1/users/me/wishlists');
    expect(res.status).toBe(200);
    expect(res.body.data.wishlists).toEqual([]);
  });

  it('POST /me/wishlists should create wishlist', async () => {
    jest.spyOn(Wishlist, 'create').mockResolvedValue({
      _id: new mongoose.Types.ObjectId(), userId: 'test-user-id',
      name: 'Favorites', isPublic: false, shareToken: 'abc123', items: [],
      toJSON() { return this; },
    } as any);

    const res = await request(app).post('/api/v1/users/me/wishlists').send({
      name: 'Favorites',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.wishlist.name).toBe('Favorites');
  });

  it('POST /me/wishlists/:id/items/:productId should add item', async () => {
    const wlId = new mongoose.Types.ObjectId().toString();
    const mockWishlist = {
      _id: wlId, userId: 'test-user-id',
      items: [],
      save: jest.fn().mockResolvedValue(undefined),
      toJSON() { return this; },
    };
    jest.spyOn(Wishlist, 'findOne').mockResolvedValue(mockWishlist as any);

    const res = await request(app).post(`/api/v1/users/me/wishlists/${wlId}/items/prod-1`);
    expect(res.status).toBe(200);
    expect(mockWishlist.items).toHaveLength(1);
  });

  it('POST /me/wishlists/:id/items/:productId should reject duplicates', async () => {
    const wlId = new mongoose.Types.ObjectId().toString();
    jest.spyOn(Wishlist, 'findOne').mockResolvedValue({
      _id: wlId, userId: 'test-user-id',
      items: [{ productId: 'prod-1', addedAt: new Date() }],
    } as any);

    const res = await request(app).post(`/api/v1/users/me/wishlists/${wlId}/items/prod-1`);
    expect(res.status).toBe(409);
  });

  it('DELETE /me/wishlists/:id/items/:productId should remove item', async () => {
    const wlId = new mongoose.Types.ObjectId().toString();
    const mockWishlist = {
      _id: wlId, userId: 'test-user-id',
      items: [{ productId: 'prod-1', addedAt: new Date() }],
      save: jest.fn().mockResolvedValue(undefined),
      toJSON() { return this; },
    };
    jest.spyOn(Wishlist, 'findOne').mockResolvedValue(mockWishlist as any);

    const res = await request(app).delete(`/api/v1/users/me/wishlists/${wlId}/items/prod-1`);
    expect(res.status).toBe(200);
    expect(mockWishlist.items).toHaveLength(0);
  });

  it('GET /wishlists/share/:token should return public wishlist', async () => {
    jest.spyOn(Wishlist, 'findOne').mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          name: 'Shared List', isPublic: true, items: [],
        }),
      }),
    } as any);

    const res = await request(app).get('/api/v1/users/wishlists/share/abc123');
    expect(res.status).toBe(200);
    expect(res.body.data.wishlist.name).toBe('Shared List');
  });

  it('GET /wishlists/share/:token should 404 for private wishlist', async () => {
    jest.spyOn(Wishlist, 'findOne').mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    } as any);

    const res = await request(app).get('/api/v1/users/wishlists/share/invalid-token');
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════
// HISTORY
// ═════════════════════════════════════════════════════════════════════
describe('Recently Viewed & Search History', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('GET /me/recently-viewed should list items', async () => {
    jest.spyOn(RecentlyViewed, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
        }),
      }),
    } as any);

    const res = await request(app).get('/api/v1/users/me/recently-viewed');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });

  it('DELETE /me/recently-viewed should clear history', async () => {
    jest.spyOn(RecentlyViewed, 'deleteMany').mockResolvedValue({} as any);
    const res = await request(app).delete('/api/v1/users/me/recently-viewed');
    expect(res.status).toBe(200);
  });

  it('GET /me/search-history should list items', async () => {
    jest.spyOn(SearchHistory, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
        }),
      }),
    } as any);

    const res = await request(app).get('/api/v1/users/me/search-history');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });

  it('DELETE /me/search-history should clear history', async () => {
    jest.spyOn(SearchHistory, 'deleteMany').mockResolvedValue({} as any);
    const res = await request(app).delete('/api/v1/users/me/search-history');
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════
// NOTIFICATION PREFERENCES
// ═════════════════════════════════════════════════════════════════════
describe('Notification Preferences', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('GET /me/notification-prefs should return prefs', async () => {
    jest.spyOn(UserProfile, 'findOne').mockReturnValue({
      select: jest.fn().mockResolvedValue({
        notificationPrefs: { email: true, sms: true, push: true, promotions: false },
      }),
    } as any);

    const res = await request(app).get('/api/v1/users/me/notification-prefs');
    expect(res.status).toBe(200);
    expect(res.body.data.preferences.email).toBe(true);
  });

  it('PATCH /me/notification-prefs should update prefs', async () => {
    const mockProfile = {
      userId: 'test-user-id', isDeleted: false,
      notificationPrefs: { email: true, sms: true, push: true, promotions: false },
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(UserProfile, 'findOne').mockResolvedValue(mockProfile as any);

    const res = await request(app).patch('/api/v1/users/me/notification-prefs').send({
      promotions: true,
      sms: false,
    });

    expect(res.status).toBe(200);
    expect(mockProfile.notificationPrefs.promotions).toBe(true);
    expect(mockProfile.notificationPrefs.sms).toBe(false);
  });

  it('PATCH /me/notification-prefs should reject invalid fields', async () => {
    const res = await request(app).patch('/api/v1/users/me/notification-prefs').send({
      unknownPref: true,
    });
    expect(res.status).toBe(400);
  });
});
