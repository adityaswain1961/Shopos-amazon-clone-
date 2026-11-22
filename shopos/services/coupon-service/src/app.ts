import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { z } from 'zod';
import { createJwtVerifier } from '@shopos/jwt-verifier';
import { setupMetrics, registerGracefulShutdown } from '@shopos/observability';

const PORT = Number(process.env.PORT) || 3009;
const JWKS_URL = process.env.AUTH_JWKS_URL || 'http://localhost:3001/.well-known/jwks.json';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const COUPON_CACHE_TTL = 60; // seconds

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 5_000,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  enableAutoPipelining: true,
  maxRetriesPerRequest: 2,
  commandTimeout: 1000,
});
redis.on('error', () => undefined); // logged via readiness; avoid log spam

const requireAuth = createJwtVerifier({ jwksUrl: JWKS_URL });

const log = (level: 'info' | 'warn' | 'error', msg: string, meta: Record<string, unknown> = {}) =>
  console[level === 'info' ? 'log' : level](
    JSON.stringify({ level, service: 'coupon-service', msg, ...meta, ts: new Date().toISOString() }),
  );

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: FRONTEND_URL.split(','), credentials: true }));
app.use(express.json({ limit: '8kb' }));

const { middleware: metrics } = setupMetrics(app, 'coupon-service', {
  readinessChecks: { postgres: async () => (await pool.query('SELECT 1')).rowCount === 1 },
});
app.use(metrics);

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', service: 'coupon-service' }, error: null });
});

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

interface CouponRow {
  id: string;
  code: string;
  type: 'percentage' | 'flat' | string;
  value: string;
  min_order_value: string | null;
  max_discount: string | null;
  usage_limit: number | null;
  used_count: number;
  per_user_limit: number | null;
}

/** Coupon definitions are read on every checkout → cache them briefly in Redis. */
async function loadCoupon(code: string): Promise<CouponRow | null> {
  const key = `coupon:def:${code}`;
  try {
    const cached = await redis.get(key);
    if (cached) return cached === 'null' ? null : (JSON.parse(cached) as CouponRow);
  } catch {
    /* fall through to DB */
  }
  const { rows } = await pool.query<CouponRow>(
    `SELECT id, code, type, value, min_order_value, max_discount, usage_limit, used_count, per_user_limit
       FROM coupons
      WHERE code = $1 AND is_active = true
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [code],
  );
  const coupon = rows[0] ?? null;
  redis.set(key, JSON.stringify(coupon), 'EX', coupon ? COUPON_CACHE_TTL : 30).catch(() => undefined);
  return coupon;
}

const validateBody = z.object({
  code: z.string().trim().min(1).max(50).toUpperCase(),
  orderTotal: z.coerce.number().nonnegative().max(100_000_000),
});

// Validation is a *preview*. The order service re-validates and redeems the
// coupon atomically when the order is placed, so this endpoint can be cached.
app.post(
  '/api/v1/coupons/validate',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = validateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, data: null, error: 'code and orderTotal are required' });
      return;
    }
    const { code, orderTotal } = parsed.data;
    const userId = req.user!.sub;

    const coupon = await loadCoupon(code);
    if (!coupon) {
      res.status(404).json({ success: false, data: null, error: 'Invalid or expired coupon' });
      return;
    }

    const minOrder = Number(coupon.min_order_value ?? 0);
    if (orderTotal < minOrder) {
      res.status(400).json({ success: false, data: null, error: `Minimum order value is ${minOrder}` });
      return;
    }
    if (coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit) {
      res.status(400).json({ success: false, data: null, error: 'Coupon usage limit reached' });
      return;
    }

    const perUser = coupon.per_user_limit ?? 1;
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2`,
      [coupon.id, userId],
    );
    if ((rows[0]?.n ?? 0) >= perUser) {
      res.status(400).json({ success: false, data: null, error: 'You have already used this coupon' });
      return;
    }

    let discount =
      coupon.type === 'percentage' ? (orderTotal * Number(coupon.value)) / 100 : Number(coupon.value);
    if (coupon.max_discount != null) discount = Math.min(discount, Number(coupon.max_discount));
    discount = Math.min(Math.round(discount * 100) / 100, orderTotal);

    res.set('Cache-Control', 'private, no-store');
    res.json({
      success: true,
      data: {
        code: coupon.code,
        type: coupon.type,
        discountAmount: discount,
        finalTotal: Math.round((orderTotal - discount) * 100) / 100,
      },
      error: null,
    });
  }),
);

app.get(
  '/api/v1/coupons',
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT code, type, value, min_order_value, max_discount, expires_at
         FROM coupons
        WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())
          AND (starts_at IS NULL OR starts_at <= NOW())
        ORDER BY created_at DESC
        LIMIT 50`,
    );
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.json({ success: true, data: rows, error: null });
  }),
);

app.use((_req, res) => {
  res.status(404).json({ success: false, data: null, error: 'Route not found' });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log('error', 'request failed', { error: err.message });
  res.status(500).json({ success: false, data: null, error: 'Internal server error' });
});

const server = app.listen(PORT, () => log('info', `coupon-service listening on ${PORT}`));
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

registerGracefulShutdown(server, async () => {
  await redis.quit().catch(() => undefined);
  await pool.end();
});
