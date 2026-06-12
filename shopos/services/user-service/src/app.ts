import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { connectKafka, disconnectKafka } from './config/kafka.js';
import { setupMetrics } from '@shopos/observability';
import { correlationId } from './middleware/correlationId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sendSuccess } from './utils/apiResponse.js';
import { logger } from './utils/logger.js';
import userRoutes from './routes/user.routes.js';

// ─── Create Express App ─────────────────────────────────────────────

const app = express();

// ─── Global Middleware ──────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Morgan HTTP logging — skip in test environment
if (env.NODE_ENV !== 'test') {
  app.use(morgan('short'));
}

// Correlation ID on every request
app.use(correlationId);

const { middleware: metricsMiddleware } = setupMetrics(app, 'user-service');
app.use(metricsMiddleware);

// Trust proxy (behind Kong / load balancer)
app.set('trust proxy', 1);

// ─── Health Check ───────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  sendSuccess(res, {
    status: 'ok',
    service: 'user-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ─── Routes ─────────────────────────────────────────────────────────

app.use('/api/v1/users', userRoutes);

// ─── Global Error Handler ───────────────────────────────────────────

app.use(errorHandler);

// ─── 404 Handler ────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    data: null,
    error: 'Route not found',
  });
});

// ─── Server Startup ─────────────────────────────────────────────────

async function startServer(): Promise<void> {
  try {
    // 1. Connect to MongoDB
    await connectDatabase();

    // 2. Connect to Redis
    await connectRedis();

    // 3. Connect Kafka producer
    await connectKafka();

    // 4. Start HTTP server
    const server = app.listen(env.PORT, () => {
      logger.info(`🚀 User Service running on port ${env.PORT}`, {
        env: env.NODE_ENV,
        port: env.PORT,
      });
    });

    // ─── Graceful Shutdown ────────────────────────────────────────

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');
        await disconnectKafka();
        await disconnectRedis();
        await disconnectDatabase();
        logger.info('All connections closed. Exiting.');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to start user service', { error: message });
    process.exit(1);
  }
}

// Only start the server if this file is run directly (not imported in tests)
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app };
