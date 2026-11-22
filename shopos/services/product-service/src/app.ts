import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import { env } from './config/env.js';
import { getPrismaClient, disconnectPrisma, isDatabaseReady } from './config/prisma.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { connectKafka, disconnectKafka } from './config/kafka.js';
import { setupMetrics, registerGracefulShutdown } from '@shopos/observability';
import { correlationId } from './middleware/correlationId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sendSuccess } from './utils/apiResponse.js';
import { logger } from './utils/logger.js';
import productRoutes from './routes/product.routes.js';
import categoryRoutes from './routes/category.routes.js';

const app = express();

app.disable('x-powered-by');
// Strong ETags let browsers/CDNs revalidate with a cheap 304.
app.set('etag', 'strong');
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL.split(','), credentials: true }));
// Listing payloads are JSON-heavy; gzip cuts egress (which you pay for) ~70-80%.
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '256kb' }));

if (env.NODE_ENV === 'development' || env.ACCESS_LOG) {
  app.use(morgan('short'));
}

app.use(correlationId);

// Readiness depends on Postgres only: Redis is a cache and the service
// degrades gracefully without it.
const { middleware: metricsMiddleware } = setupMetrics(app, 'product-service', {
  readinessChecks: { postgres: isDatabaseReady },
});
app.use(metricsMiddleware);

app.get('/health', (_req, res) => {
  sendSuccess(res, { status: 'ok', service: 'product-service', uptime: process.uptime() });
});

app.use('/api/v1/products/categories', categoryRoutes);
app.use('/api/v1/products', productRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, data: null, error: 'Route not found' });
});
app.use(errorHandler);

async function startServer(): Promise<void> {
  try {
    await getPrismaClient().$connect();
    await connectRedis().catch((err) =>
      logger.warn('Redis unavailable at startup; serving uncached', { error: (err as Error).message }),
    );
    await connectKafka();

    const server = app.listen(env.PORT, () => {
      logger.info(`Product Service listening on ${env.PORT}`, { env: env.NODE_ENV });
    });
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;

    registerGracefulShutdown(
      server,
      async () => {
        await disconnectKafka();
        await disconnectRedis();
        await disconnectPrisma();
      },
      { log: (m) => logger.info(m) },
    );
  } catch (error) {
    logger.error('Failed to start product service', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  void startServer();
}

export { app };
