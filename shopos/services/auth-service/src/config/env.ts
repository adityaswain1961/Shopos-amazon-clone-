import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  // MongoDB
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  MONGO_MAX_POOL_SIZE: z.coerce.number().int().positive().default(50),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // JWT RS256 — in production JWT_PRIVATE_KEY is mandatory (see tokenService)
  JWT_PRIVATE_KEY: z.string().default(''),
  JWT_PUBLIC_KEY: z.string().default(''),
  JWT_PREVIOUS_PUBLIC_KEY: z.string().default(''),
  JWT_ACCESS_TOKEN_TTL: z.coerce.number().default(900),       // 15 minutes
  JWT_REFRESH_TOKEN_TTL: z.coerce.number().default(604800),   // 7 days

  // Password hashing. Cost 11 ≈ 4x cheaper than 13 and above OWASP's minimum of 10.
  // bcrypt is the single most CPU-expensive thing on the login path, so this
  // directly drives how many auth pods you pay for during a login spike.
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(11),

  // Email
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('noreply@shopos.dev'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),

  // Kafka
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('auth-service'),

  // Frontend
  FRONTEND_URL: z.string().default('http://localhost:3000'),

  // Logging
  LOG_LEVEL: z.string().default(''),
  ACCESS_LOG: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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
