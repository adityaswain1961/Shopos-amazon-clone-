jest.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3003,
    DATABASE_URL: 'postgresql://test',
    REDIS_URL: 'redis://test',
    AUTH_JWKS_URL: 'http://localhost:3001/.well-known/jwks.json',
    JWT_PUBLIC_KEY: '',
    KAFKA_BROKERS: 'localhost:9092',
    KAFKA_CLIENT_ID: 'product-test',
    FRONTEND_URL: 'http://localhost:3000',
    LOG_LEVEL: 'error',
    ACCESS_LOG: false,
  },
}));

// In-memory Redis stand-in
const store = new Map<string, string>();
const redis = {
  get: jest.fn(async (k: string) => store.get(k) ?? null),
  set: jest.fn(async (k: string, v: string) => {
    store.set(k, v);
    return 'OK';
  }),
  del: jest.fn(async (...keys: string[]) => keys.filter((k) => store.delete(k)).length),
  incr: jest.fn(async (k: string) => {
    const n = Number(store.get(k) ?? 0) + 1;
    store.set(k, String(n));
    return n;
  }),
  eval: jest.fn(async () => [1, 60000]),
};
jest.mock('../config/redis', () => ({
  getRedisClient: () => redis,
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
  isRedisReady: () => true,
}));

jest.mock('../config/kafka', () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined),
  connectKafka: jest.fn(),
  disconnectKafka: jest.fn(),
}));

const prisma = {
  product: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
};
jest.mock('../config/prisma', () => ({
  getPrismaClient: () => prisma,
  disconnectPrisma: jest.fn(),
  isDatabaseReady: jest.fn().mockResolvedValue(true),
}));

import request from 'supertest';
import { app } from '../app';

const PRODUCT = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Phone',
  slug: 'phone',
  status: 'published',
  basePrice: '999.00',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  images: [],
  variants: [],
};

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe('GET /api/v1/products', () => {
  it('only lists published products and is CDN-cacheable', async () => {
    prisma.product.findMany.mockResolvedValue([PRODUCT]);
    const res = await request(app).get('/api/v1/products?limit=10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.headers['cache-control']).toMatch(/public/);
    expect(res.headers['cache-control']).toMatch(/s-maxage/);
    const args = prisma.product.findMany.mock.calls[0][0];
    expect(JSON.stringify(args.where)).toContain('"status":"published"');
    expect(args.take).toBe(11); // limit + 1 to detect the next page
    // cost price must never be selected for public listings
    expect(args.select.costPrice).toBeUndefined();
  });

  it('serves the second identical request from cache', async () => {
    prisma.product.findMany.mockResolvedValue([PRODUCT]);
    await request(app).get('/api/v1/products?limit=10');
    await request(app).get('/api/v1/products?limit=10');
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a tampered cursor', async () => {
    const res = await request(app).get('/api/v1/products?cursor=not-a-cursor');
    expect(res.status).toBe(400);
  });

  it('requires auth for "mine" listings', async () => {
    const res = await request(app).get('/api/v1/products?mine=true');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/products/:idOrSlug', () => {
  it('looks up slugs by slug (never casts a slug to a UUID column)', async () => {
    prisma.product.findUnique.mockResolvedValue(PRODUCT);
    const res = await request(app).get('/api/v1/products/phone');
    expect(res.status).toBe(200);
    expect(prisma.product.findUnique.mock.calls[0][0].where).toEqual({ slug: 'phone' });
  });

  it('collapses concurrent cache misses into a single DB query (stampede protection)', async () => {
    let release!: () => void;
    prisma.product.findUnique.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(PRODUCT))),
    );

    const pending = Array.from({ length: 20 }, () => request(app).get('/api/v1/products/phone'));
    const all = Promise.all(pending);
    await new Promise((r) => setTimeout(r, 100));
    release();
    const responses = await all;

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(prisma.product.findUnique).toHaveBeenCalledTimes(1);
  });

  it('caches misses too, so bots probing random slugs do not hit the DB each time', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    expect((await request(app).get('/api/v1/products/nope')).status).toBe(404);
    expect((await request(app).get('/api/v1/products/nope')).status).toBe(404);
    expect(prisma.product.findUnique).toHaveBeenCalledTimes(1);
  });

  it('hides drafts from the public', async () => {
    prisma.product.findUnique.mockResolvedValue({ ...PRODUCT, status: 'draft', sellerId: 'seller-1' });
    const res = await request(app).get('/api/v1/products/phone');
    expect(res.status).toBe(404);
  });
});

describe('writes', () => {
  it('rejects unauthenticated product creation', async () => {
    const res = await request(app).post('/api/v1/products').send({ title: 'x', basePrice: 1 });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated category creation', async () => {
    const res = await request(app).post('/api/v1/products/categories').send({ name: 'x' });
    expect(res.status).toBe(401);
  });
});
