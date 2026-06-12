-- Product service tables (Prisma-managed schema)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID REFERENCES categories(id),
  name        VARCHAR(120) NOT NULL,
  slug        VARCHAR(150) UNIQUE NOT NULL,
  description TEXT,
  banner_url  TEXT,
  depth       INT DEFAULT 0,
  path        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL,
  category_id     UUID REFERENCES categories(id),
  title           VARCHAR(300) NOT NULL,
  slug            VARCHAR(350) UNIQUE NOT NULL,
  description     TEXT,
  highlights      TEXT[],
  specs           JSONB,
  status          VARCHAR(20) DEFAULT 'draft',
  base_price      NUMERIC(12,2) NOT NULL,
  compare_price   NUMERIC(12,2),
  cost_price      NUMERIC(12,2),
  tax_class       VARCHAR(50),
  currency        CHAR(3) DEFAULT 'INR',
  tags            TEXT[],
  seo_title       VARCHAR(200),
  seo_description VARCHAR(500),
  is_featured     BOOLEAN DEFAULT FALSE,
  is_sponsored    BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID REFERENCES products(id) ON DELETE CASCADE,
  sku          VARCHAR(100) UNIQUE NOT NULL,
  barcode      VARCHAR(100),
  attributes   JSONB,
  price        NUMERIC(12,2),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_id  UUID REFERENCES product_variants(id),
  url         TEXT NOT NULL,
  position    INT DEFAULT 0,
  alt_text    VARCHAR(200),
  is_primary  BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS product_videos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
  hls_url     TEXT,
  thumbnail   TEXT,
  duration_s  INT
);

CREATE TABLE IF NOT EXISTS price_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID REFERENCES products(id),
  variant_id  UUID REFERENCES product_variants(id),
  price       NUMERIC(12,2),
  changed_at  TIMESTAMPTZ DEFAULT NOW(),
  changed_by  UUID
);

CREATE TABLE IF NOT EXISTS category_attributes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID REFERENCES categories(id),
  attr_key      VARCHAR(100),
  attr_type     VARCHAR(30),
  options       TEXT[],
  is_required   BOOLEAN DEFAULT FALSE
);
