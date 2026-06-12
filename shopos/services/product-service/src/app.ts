import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import { getPrismaClient, disconnectPrisma } from './config/prisma.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { connectKafka, disconnectKafka } from './config/kafka.js';
import { setupMetrics } from '@shopos/observability';
import { correlationId } from './middleware/correlationId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sendSuccess } from './utils/apiResponse.js';
import { logger } from './utils/logger.js';
import productRoutes from './routes/product.routes.js';
import categoryRoutes from './routes/category.routes.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (env.NODE_ENV !== 'test') {
  app.use(morgan('short'));
}

app.use(correlationId);
const { middleware: metricsMiddleware } = setupMetrics(app, 'product-service');
app.use(metricsMiddleware);
app.set('trust proxy', 1);

app.get('/health', (_req, res) => {
  sendSuccess(res, {
    status: 'ok',
    service: 'product-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use('/api/v1/products/categories', categoryRoutes);
app.use('/api/v1/products', productRoutes);

app.use(errorHandler);

app.use((_req, res) => {
  res.status(404).json({ success: false, data: null, error: 'Route not found' });
});

async function startServer(): Promise<void> {
  try {
    getPrismaClient();
    await connectRedis();
    await connectKafka();

    const server = app.listen(env.PORT, () => {
      logger.info(`Product Service running on port ${env.PORT}`);
    });

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down...`);
      server.close(async () => {
        await disconnectKafka();
        await disconnectRedis();
        await disconnectPrisma();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start product service', { error });
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app };
