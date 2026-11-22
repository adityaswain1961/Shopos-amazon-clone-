-- Upgrade an EXISTING ShopOS database created from the original init.sql.
-- Idempotent: safe to run more than once.  psql "$DATABASE_URL" -f 002_scale_hardening.sql
--
-- On a large production table, prefer CREATE INDEX CONCURRENTLY (outside a
-- transaction) for the index section to avoid blocking writes.

BEGIN;

-- 1. User/seller ids are MongoDB ObjectIds from auth-service, not UUIDs.
ALTER TABLE warehouses            ALTER COLUMN seller_id  TYPE VARCHAR(64) USING seller_id::text;
ALTER TABLE stock_movements       ALTER COLUMN created_by TYPE VARCHAR(64) USING created_by::text;
ALTER TABLE stock_movements       ALTER COLUMN reference_id TYPE VARCHAR(100) USING reference_id::text;
ALTER TABLE carts                 ALTER COLUMN user_id    TYPE VARCHAR(64) USING user_id::text;
ALTER TABLE cart_items            ALTER COLUMN seller_id  TYPE VARCHAR(64) USING seller_id::text;
ALTER TABLE orders                ALTER COLUMN user_id    TYPE VARCHAR(64) USING user_id::text;
ALTER TABLE orders                ALTER COLUMN cart_id    TYPE VARCHAR(100) USING cart_id::text;
ALTER TABLE orders                ALTER COLUMN idempotency_key TYPE VARCHAR(100) USING idempotency_key::text;
ALTER TABLE sub_orders            ALTER COLUMN seller_id  TYPE VARCHAR(64) USING seller_id::text;
ALTER TABLE returns               ALTER COLUMN user_id    TYPE VARCHAR(64) USING user_id::text;
ALTER TABLE payments              ALTER COLUMN user_id    TYPE VARCHAR(64) USING user_id::text;
ALTER TABLE payments              ALTER COLUMN idempotency_key TYPE VARCHAR(100) USING idempotency_key::text;
ALTER TABLE reviews               ALTER COLUMN user_id    TYPE VARCHAR(64) USING user_id::text;
ALTER TABLE review_votes          ALTER COLUMN user_id    TYPE VARCHAR(64) USING user_id::text;
ALTER TABLE seller_review_replies ALTER COLUMN seller_id  TYPE VARCHAR(64) USING seller_id::text;
ALTER TABLE coupons               ALTER COLUMN seller_id  TYPE VARCHAR(64) USING seller_id::text;
ALTER TABLE coupon_redemptions    ALTER COLUMN user_id    TYPE VARCHAR(64) USING user_id::text;

-- 2. New columns
ALTER TABLE orders                ADD COLUMN IF NOT EXISTS user_email      VARCHAR(320);
ALTER TABLE orders                ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(12,2);
ALTER TABLE orders                ADD COLUMN IF NOT EXISTS failure_reason  VARCHAR(200);
ALTER TABLE order_items           ADD COLUMN IF NOT EXISTS order_id        UUID REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE order_items           ADD COLUMN IF NOT EXISTS seller_id       VARCHAR(64);
ALTER TABLE stock_reservations    ADD COLUMN IF NOT EXISTS inventory_id    UUID REFERENCES inventory(id);
ALTER TABLE payments              ADD COLUMN IF NOT EXISTS client_secret   TEXT;
ALTER TABLE payments              ADD COLUMN IF NOT EXISTS failure_reason  VARCHAR(300);
ALTER TABLE product_ratings_cache ADD COLUMN IF NOT EXISTS rating_sum      BIGINT NOT NULL DEFAULT 0;

-- backfill rating_sum from the distribution where we can
UPDATE product_ratings_cache
   SET rating_sum = COALESCE((SELECT SUM(key::int * value::int) FROM jsonb_each_text(rating_dist)), 0)
 WHERE rating_sum = 0 AND rating_dist IS NOT NULL;

-- 3. Idempotency: per-user order keys, one payment per order
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_idempotency_key_key;
DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_user_idempotency_key UNIQUE (user_id, idempotency_key);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT payments_order_id_key UNIQUE (order_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- 4. Outbox
CREATE TABLE IF NOT EXISTS outbox_events (
  id            BIGSERIAL PRIMARY KEY,
  aggregate_id  VARCHAR(100) NOT NULL,
  topic         VARCHAR(100) NOT NULL,
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at  TIMESTAMPTZ,
  attempts      INT NOT NULL DEFAULT 0
);

-- 5. Integrity
DO $$ BEGIN
  ALTER TABLE inventory ADD CONSTRAINT inventory_reserved_le_quantity CHECK (reserved <= quantity AND reserved >= 0 AND quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. Hot-path indexes
CREATE INDEX IF NOT EXISTS idx_inventory_sku                ON inventory (sku);
CREATE INDEX IF NOT EXISTS idx_reservations_order           ON stock_reservations (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservations_order_sku ON stock_reservations (order_id, sku) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_expiry          ON stock_reservations (expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_orders_user_created          ON orders (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order            ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product          ON order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished           ON outbox_events (id) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_product_feed         ON reviews (product_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user      ON coupon_redemptions (coupon_id, user_id);

COMMIT;
