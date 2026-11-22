-- Scale hardening (2026-11-06)
-- 1. seller_id / changed_by hold auth-service user ids (MongoDB ObjectIds), not UUIDs.
ALTER TABLE products      ALTER COLUMN seller_id  TYPE VARCHAR(64) USING seller_id::text;
ALTER TABLE price_history ALTER COLUMN changed_by TYPE VARCHAR(64) USING changed_by::text;

-- 2. Indexes for the storefront hot paths (keyset pagination, category pages, seller dashboard).
--    On a large live table run these manually with CREATE INDEX CONCURRENTLY instead.
CREATE INDEX IF NOT EXISTS idx_products_status_created          ON products (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_products_status_price            ON products (status, base_price, id);
CREATE INDEX IF NOT EXISTS idx_products_category_status_created ON products (category_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_seller_created          ON products (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_variants_product         ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product           ON product_images (product_id, position);
