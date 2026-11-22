import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase, isDatabaseReady } from './config/db.js';
import { connectRedis, disconnectRedis, isRedisReady } from './config/redis.js';
import { connectKafka, disconnectKafka } from './config/kafka.js';
import { setupMetrics, registerGracefulShutdown } from '@shopos/observability';
import { correlationId } from './middleware/correlationId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sendSuccess } from './utils/apiResponse.js';
import { logger } from './utils/logger.js';
import userRoutes from './routes/user.routes.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL.split(','), credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

if (env.NODE_ENV === 'development' || env.ACCESS_LOG) {
  app.use(morgan('short'));
}

app.use(correlationId);

const { middleware: metricsMiddleware } = setupMetrics(app, 'user-service', {
  readinessChecks: { mongo: isDatabaseReady, redis: isRedisReady },
});
app.use(metricsMiddleware);

app.get('/health', (_req, res) => {
  sendSuccess(res, { status: 'ok', service: 'user-service', uptime: process.uptime() });
});

app.use('/api/v1/users', userRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, data: null, error: 'Route not found' });
});
app.use(errorHandler);

async function startServer(): Promise<void> {
  try {
    await connectDatabase();
    await connectRedis();
    await connectKafka();

    const server = app.listen(env.PORT, () => {
      logger.info(`User Service listening on ${env.PORT}`, { env: env.NODE_ENV });
    });
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;

    registerGracefulShutdown(
      server,
      async () => {
        await disconnectKafka();
        await disconnectRedis();
        await disconnectDatabase();
      },
      { log: (m) => logger.info(m) },
    );
  } catch (error) {
    logger.error('Failed to start user service', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  void startServer();
}

export { app };
