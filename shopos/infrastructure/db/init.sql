-- ShopOS PostgreSQL bootstrap (shared DB, schema-separated concerns)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Inventory ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   UUID,
  name        VARCHAR(200),
  address     JSONB,
  type        VARCHAR(20) DEFAULT 'seller',
  is_active   BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inventory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                 VARCHAR(100) NOT NULL,
  variant_id          UUID,
  warehouse_id        UUID REFERENCES warehouses(id),
  quantity            INT NOT NULL DEFAULT 0,
  reserved            INT NOT NULL DEFAULT 0,
  low_stock_threshold INT DEFAULT 10,
  UNIQUE(sku, warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_reservations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id       VARCHAR(100),
  order_id      VARCHAR(100),
  sku           VARCHAR(100) NOT NULL,
  warehouse_id  UUID REFERENCES warehouses(id),
  quantity      INT NOT NULL,
  expires_at    TIMESTAMPTZ,
  status        VARCHAR(20) DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           VARCHAR(100),
  warehouse_id  UUID,
  delta         INT,
  reason        VARCHAR(50),
  reference_id  UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  created_by    UUID
);

-- ─── Cart ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,
  guest_token VARCHAR(100) UNIQUE,
  status      VARCHAR(20) DEFAULT 'active',
  currency    CHAR(3) DEFAULT 'INR',
  coupon_code VARCHAR(50),
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cart_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id         UUID REFERENCES carts(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL,
  variant_id      UUID,
  seller_id       UUID NOT NULL,
  quantity        INT NOT NULL DEFAULT 1,
  unit_price      NUMERIC(12,2),
  saved_for_later BOOLEAN DEFAULT FALSE,
  added_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Orders ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  cart_id           UUID,
  order_number      VARCHAR(30) UNIQUE NOT NULL,
  status            VARCHAR(30) DEFAULT 'pending',
  total_amount      NUMERIC(12,2),
  discount_amount   NUMERIC(12,2) DEFAULT 0,
  tax_amount        NUMERIC(12,2) DEFAULT 0,
  shipping_amount   NUMERIC(12,2) DEFAULT 0,
  currency          CHAR(3) DEFAULT 'INR',
  coupon_code       VARCHAR(50),
  shipping_address  JSONB,
  billing_address   JSONB,
  idempotency_key   UUID UNIQUE,
  saga_status       VARCHAR(30) DEFAULT 'pending',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sub_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID REFERENCES orders(id),
  seller_id     UUID NOT NULL,
  status        VARCHAR(30) DEFAULT 'pending',
  subtotal      NUMERIC(12,2),
  shipping_cost NUMERIC(12,2),
  tracking_awb  VARCHAR(100),
  carrier       VARCHAR(50),
  est_delivery  DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_order_id  UUID REFERENCES sub_orders(id),
  product_id    UUID NOT NULL,
  variant_id    UUID,
  product_title VARCHAR(300),
  sku           VARCHAR(100),
  quantity      INT NOT NULL,
  unit_price    NUMERIC(12,2),
  total_price   NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS order_timeline (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID REFERENCES orders(id),
  sub_order_id UUID,
  event       VARCHAR(100),
  description TEXT,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS returns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID REFERENCES orders(id),
  sub_order_id    UUID REFERENCES sub_orders(id),
  user_id         UUID,
  reason          VARCHAR(200),
  description     TEXT,
  photo_urls      TEXT[],
  status          VARCHAR(30) DEFAULT 'requested',
  refund_amount   NUMERIC(12,2),
  refund_method   VARCHAR(30),
  requested_at    TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

-- ─── Payments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID NOT NULL,
  user_id              UUID,
  amount               NUMERIC(12,2) NOT NULL,
  currency             CHAR(3) DEFAULT 'INR',
  status               VARCHAR(30) DEFAULT 'pending',
  provider             VARCHAR(20) DEFAULT 'stripe',
  provider_intent_id   VARCHAR(200) UNIQUE,
  provider_customer_id VARCHAR(200),
  payment_method       VARCHAR(50),
  idempotency_key      UUID UNIQUE,
  metadata             JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         UUID REFERENCES payments(id),
  return_id          UUID,
  amount             NUMERIC(12,2),
  reason             TEXT,
  provider_refund_id VARCHAR(200),
  status             VARCHAR(20) DEFAULT 'pending',
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   VARCHAR(30),
  entity_id     UUID,
  debit         NUMERIC(12,2) DEFAULT 0,
  credit        NUMERIC(12,2) DEFAULT 0,
  balance       NUMERIC(12,2),
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Reviews ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL,
  user_id         UUID NOT NULL,
  order_id        UUID,
  rating          SMALLINT CHECK (rating BETWEEN 1 AND 5),
  title           VARCHAR(200),
  body            TEXT,
  photo_urls      TEXT[],
  video_url       TEXT,
  is_verified     BOOLEAN DEFAULT FALSE,
  helpful_count   INT DEFAULT 0,
  spam_score      NUMERIC(4,3),
  status          VARCHAR(20) DEFAULT 'published',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, user_id)
);

CREATE TABLE IF NOT EXISTS review_votes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   UUID REFERENCES reviews(id),
  user_id     UUID,
  is_helpful  BOOLEAN,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(review_id, user_id)
);

CREATE TABLE IF NOT EXISTS seller_review_replies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   UUID REFERENCES reviews(id),
  seller_id   UUID NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_ratings_cache (
  product_id      UUID PRIMARY KEY,
  avg_rating      NUMERIC(3,2),
  total_reviews   INT,
  rating_dist     JSONB,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Coupons ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(50) UNIQUE NOT NULL,
  type            VARCHAR(30) NOT NULL,
  value           NUMERIC(12,2) NOT NULL,
  min_order_value NUMERIC(12,2) DEFAULT 0,
  max_discount    NUMERIC(12,2),
  usage_limit     INT,
  used_count      INT DEFAULT 0,
  per_user_limit  INT DEFAULT 1,
  seller_id       UUID,
  category_ids    UUID[],
  starts_at       TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id   UUID REFERENCES coupons(id),
  user_id     UUID NOT NULL,
  order_id    UUID,
  redeemed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default warehouse + sample inventory for dev
INSERT INTO warehouses (id, name, type)
SELECT '00000000-0000-0000-0000-000000000001', 'Platform Main', 'platform'
WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE id = '00000000-0000-0000-0000-000000000001');

INSERT INTO inventory (sku, variant_id, warehouse_id, quantity, reserved)
SELECT 'SKU-DEMO-001', gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 100, 0
WHERE NOT EXISTS (SELECT 1 FROM inventory WHERE sku = 'SKU-DEMO-001');

INSERT INTO coupons (code, type, value, usage_limit, expires_at)
SELECT 'WELCOME10', 'percentage', 10, 1000, NOW() + INTERVAL '1 year'
WHERE NOT EXISTS (SELECT 1 FROM coupons WHERE code = 'WELCOME10');
