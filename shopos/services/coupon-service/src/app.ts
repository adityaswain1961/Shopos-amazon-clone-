import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import Redis from 'ioredis';

const app = express();
const PORT = Number(process.env.PORT) || 3009;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', service: 'coupon-service' } });
});

app.post('/api/v1/coupons/validate', async (req, res) => {
  try {
    const { code, orderTotal, userId } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'code is required', data: null });
    }

    const { rows } = await pool.query(
      `SELECT * FROM coupons WHERE code = $1 AND is_active = true
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [code.toUpperCase()],
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Invalid coupon', data: null });
    }

    const coupon = rows[0];
    const total = Number(orderTotal) || 0;
    const minOrder = Number(coupon.min_order_value) || 0;

    if (total < minOrder) {
      return res.status(400).json({ success: false, error: `Minimum order ${minOrder}`, data: null });
    }

    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
      return res.status(400).json({ success: false, error: 'Coupon usage limit reached', data: null });
    }

    let discount = 0;
    if (coupon.type === 'percentage') {
      discount = (total * Number(coupon.value)) / 100;
      if (coupon.max_discount) discount = Math.min(discount, Number(coupon.max_discount));
    } else {
      discount = Number(coupon.value);
    }

    const cacheKey = `coupon:used:${userId}:${coupon.id}`;
    const userUses = await redis.get(cacheKey);
    if (userUses && Number(userUses) >= (coupon.per_user_limit || 1)) {
      return res.status(400).json({ success: false, error: 'Per-user limit reached', data: null });
    }

    res.json({
      success: true,
      data: {
        code: coupon.code,
        type: coupon.type,
        discountAmount: Math.round(discount * 100) / 100,
        finalTotal: Math.max(0, total - discount),
      },
      error: null,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message, data: null });
  }
});

app.get('/api/v1/coupons', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT code, type, value, expires_at FROM coupons WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 50`,
  );
  res.json({ success: true, data: rows, error: null });
});

app.listen(PORT, () => {
  console.log(`Coupon Service running on port ${PORT}`);
});
