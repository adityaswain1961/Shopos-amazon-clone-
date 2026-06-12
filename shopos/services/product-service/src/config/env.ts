import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3003),

  // Database (PostgreSQL)
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // JWT Verification
  AUTH_JWKS_URL: z.string().default('http://localhost:3001/.well-known/jwks.json'),
  JWT_PUBLIC_KEY: z.string().default(''),

  // AWS S3
  AWS_S3_BUCKET: z.string().default('shopos-products'),
  AWS_S3_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),

  // CDN
  CDN_BASE_URL: z.string().default('https://cdn.shopos.dev'),

  // Kafka
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('product-service'),

  // Frontend
  FRONTEND_URL: z.string().default('http://localhost:3000'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    console.error('❌ Invalid environment variables:', formatted);
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
