import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import { z } from 'zod';
import { createJwtVerifier } from '@shopos/jwt-verifier';
import { createKafkaProducer, buildEvent, publishKafkaEvent } from '@shopos/kafka-client';
import { setupMetrics, registerGracefulShutdown } from '@shopos/observability';

// ─── Config ─────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3005;
const JWKS_URL = process.env.AUTH_JWKS_URL || 'http://localhost:3001/.well-known/jwks.json';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Per-pod pool. Through PgBouncer this can stay small; total = pods × max.
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 5_000,
});

const producer = createKafkaProducer('review-service', process.env.KAFKA_BROKERS || 'localhost:9092');
let kafkaReady = false;

const requireAuth = createJwtVerifier({ jwksUrl: JWKS_URL });

const log = (level: 'info' | 'warn' | 'error', msg: string, meta: Record<string, unknown> = {}) =>
  console[level === 'info' ? 'log' : level](
    JSON.stringify({ level, service: 'review-service', msg, ...meta, ts: new Date().toISOString() }),
  );

// ─── App ────────────────────────────────────────────────────────────

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: FRONTEND_URL.split(','), credentials: true }));
app.use(express.json({ limit: '32kb' }));

const { middleware: metrics } = setupMetrics(app, 'review-service', {
  readinessChecks: {
    postgres: async () => (await pool.query('SELECT 1')).rowCount === 1,
  },
});
app.use(metrics);

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', service: 'review-service' }, error: null });
});

const uuid = z.string().uuid();
const PUBLIC_CACHE = 'public, max-age=30, s-maxage=120, stale-while-revalidate=600';

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ─── List reviews (keyset pagination) ───────────────────────────────

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().max(200).optional(),
});

app.get(
  '/api/v1/reviews/product/:productId',
  asyncRoute(async (req, res) => {
    const productId = uuid.safeParse(req.params.productId);
    const q = listQuery.safeParse(req.query);
    if (!productId.success || !q.success) {
      res.status(400).json({ success: false, data: null, error: 'Invalid product id or query' });
      return;
    }

    let cursorAt: string | null = null;
    let cursorId: string | null = null;
    if (q.data.cursor) {
      const [at, id] = Buffer.from(q.data.cursor, 'base64url').toString('utf8').split('|');
      if (!at || !id || !uuid.safeParse(id).success || Number.isNaN(Date.parse(at))) {
        res.status(400).json({ success: false, data: null, error: 'Invalid cursor' });
        return;
      }
      cursorAt = at;
      cursorId = id;
    }

    const { rows } = await pool.query(
      `SELECT id, product_id, user_id, rating, title, body, photo_urls, is_verified, helpful_count, created_at
         FROM reviews
        WHERE product_id = $1 AND status = 'published'
          AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
        ORDER BY created_at DESC, id DESC
        LIMIT $4`,
      [productId.data, cursorAt, cursorId, q.data.limit + 1],
    );

    const hasMore = rows.length > q.data.limit;
    const items = hasMore ? rows.slice(0, q.data.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${new Date(last.created_at).toISOString()}|${last.id}`).toString('base64url')
        : null;

    res.set('Cache-Control', PUBLIC_CACHE);
    res.json({ success: true, data: items, error: null, meta: { next_cursor: nextCursor, has_more: hasMore } });
  }),
);

app.get(
  '/api/v1/reviews/product/:productId/summary',
  asyncRoute(async (req, res) => {
    const productId = uuid.safeParse(req.params.productId);
    if (!productId.success) {
      res.status(400).json({ success: false, data: null, error: 'Invalid product id' });
      return;
    }
    const { rows } = await pool.query(
      `SELECT product_id, avg_rating, total_reviews, rating_dist, updated_at
         FROM product_ratings_cache WHERE product_id = $1`,
      [productId.data],
    );
    res.set('Cache-Control', PUBLIC_CACHE);
    res.json({
      success: true,
      data: rows[0] ?? { product_id: productId.data, avg_rating: 0, total_reviews: 0, rating_dist: {} },
      error: null,
    });
  }),
);

// ─── Create review ──────────────────────────────────────────────────

const createReview = z.object({
  productId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(5000).default(''),
  photoUrls: z.array(z.string().url().max(2048)).max(6).default([]),
});

app.post(
  '/api/v1/reviews',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = createReview.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, data: null, error: parsed.error.errors.map((e) => e.message).join('; ') });
      return;
    }
    const input = parsed.data;
    const userId = req.user!.sub; // identity comes from the verified token, never the body

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // "Verified purchase" = user has a confirmed+ order containing this product.
      const verified = await client.query(
        `SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.user_id = $1 AND oi.product_id = $2
            AND o.status IN ('confirmed', 'shipped', 'delivered')
          LIMIT 1`,
        [userId, input.productId],
      );

      const { rows } = await client.query(
        `INSERT INTO reviews (product_id, user_id, rating, title, body, photo_urls, is_verified, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'published')
         RETURNING id, product_id, user_id, rating, title, body, photo_urls, is_verified, created_at`,
        [input.productId, userId, input.rating, input.title, input.body, input.photoUrls, (verified.rowCount ?? 0) > 0],
      );

      // O(1) incremental aggregate (exact: keeps a running sum, not a rounded average).
      // Every use of $2 casts to int first: a bare `$2::text` would make Postgres
      // infer $2 as text and then reject it for the integer columns.
      await client.query(
        `INSERT INTO product_ratings_cache (product_id, rating_sum, total_reviews, avg_rating, rating_dist, updated_at)
         VALUES ($1::uuid, $2::int, 1, $2::int, jsonb_build_object($2::int::text, 1), NOW())
         ON CONFLICT (product_id) DO UPDATE SET
           rating_sum    = product_ratings_cache.rating_sum + $2::int,
           total_reviews = product_ratings_cache.total_reviews + 1,
           avg_rating    = ROUND((product_ratings_cache.rating_sum + $2::int)::numeric
                                 / (product_ratings_cache.total_reviews + 1), 2),
           rating_dist   = jsonb_set(
                             COALESCE(product_ratings_cache.rating_dist, '{}'::jsonb),
                             ARRAY[$2::int::text],
                             to_jsonb(COALESCE((product_ratings_cache.rating_dist ->> ($2::int::text))::int, 0) + 1)),
           updated_at    = NOW()`,
        [input.productId, input.rating],
      );

      await client.query('COMMIT');

      const review = rows[0];
      if (kafkaReady) {
        publishKafkaEvent(
          producer,
          'review.submitted',
          buildEvent('review.submitted', { reviewId: review.id, productId: input.productId, userId, rating: input.rating }),
          input.productId,
        ).catch((e) => log('warn', 'review.submitted publish failed', { error: (e as Error).message }));
      }

      res.status(201).json({ success: true, data: review, error: null });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((e as { code?: string }).code === '23505') {
        res.status(409).json({ success: false, data: null, error: 'You have already reviewed this product' });
        return;
      }
      throw e;
    } finally {
      client.release();
    }
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

// ─── Startup ────────────────────────────────────────────────────────

async function start() {
  producer
    .connect()
    .then(() => {
      kafkaReady = true;
      log('info', 'kafka producer connected');
    })
    .catch((e) => log('warn', 'kafka unavailable; events will be skipped', { error: (e as Error).message }));

  const server = app.listen(PORT, () => log('info', `review-service listening on ${PORT}`));
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  registerGracefulShutdown(server, async () => {
    await producer.disconnect().catch(() => undefined);
    await pool.end();
  });
}

void start();
