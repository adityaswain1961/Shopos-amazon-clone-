import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import { Kafka } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = Number(process.env.PORT) || 3005;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(helmet());
app.use(cors());
app.use(express.json());

async function publishReviewSubmitted(review: Record<string, unknown>) {
  try {
    const kafka = new Kafka({
      clientId: 'review-service',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    });
    const producer = kafka.producer();
    await producer.connect();
    await producer.send({
      topic: 'review.submitted',
      messages: [{
        value: JSON.stringify({
          eventId: uuidv4(),
          type: 'review.submitted',
          timestamp: new Date().toISOString(),
          version: '1.0',
          payload: review,
        }),
      }],
    });
    await producer.disconnect();
  } catch (e) {
    console.warn('Kafka publish skipped:', (e as Error).message);
  }
}

async function updateRatingCache(productId: string) {
  const stats = await pool.query(
    `SELECT COUNT(*)::int AS total, COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS avg
     FROM reviews WHERE product_id = $1 AND status = 'published'`,
    [productId],
  );
  const dist = await pool.query(
    `SELECT rating, COUNT(*)::int AS cnt FROM reviews
     WHERE product_id = $1 AND status = 'published' GROUP BY rating`,
    [productId],
  );
  const ratingDist: Record<string, number> = {};
  for (const r of dist.rows) ratingDist[String(r.rating)] = r.cnt;
  const row = stats.rows[0];
  await pool.query(
    `INSERT INTO product_ratings_cache (product_id, avg_rating, total_reviews, rating_dist, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (product_id) DO UPDATE SET avg_rating = $2, total_reviews = $3, rating_dist = $4, updated_at = NOW()`,
    [productId, row?.avg ?? 0, row?.total ?? 0, JSON.stringify(ratingDist)],
  );
}

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', service: 'review-service' } });
});

app.get('/api/v1/reviews/product/:productId', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM reviews WHERE product_id = $1 AND status = 'published' ORDER BY created_at DESC LIMIT 50`,
    [req.params.productId],
  );
  res.json({ success: true, data: rows, error: null });
});

app.post('/api/v1/reviews', async (req, res) => {
  try {
    const { productId, userId, orderId, rating, title, body } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO reviews (product_id, user_id, order_id, rating, title, body, is_verified, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'published') RETURNING *`,
      [productId, userId, orderId || null, rating, title, body, !!orderId],
    );
    const review = rows[0];
    await updateRatingCache(productId);
    await publishReviewSubmitted({ reviewId: review.id, productId, userId, rating });
    res.status(201).json({ success: true, data: review, error: null });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message, data: null });
  }
});

app.get('/api/v1/reviews/product/:productId/summary', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM product_ratings_cache WHERE product_id = $1`,
    [req.params.productId],
  );
  res.json({ success: true, data: rows[0] || { avg_rating: 0, total_reviews: 0 }, error: null });
});

app.listen(PORT, () => {
  console.log(`Review Service running on port ${PORT}`);
});
