import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import Redis from 'ioredis';
import { setupMetrics, registerGracefulShutdown } from '@shopos/observability';
import { createJwtVerifier } from '@shopos/jwt-verifier';
import { startConsumer } from './kafka/consumer';
import { closeEmail } from './services/emailService';

const PORT = Number(process.env.PORT) || 3013;
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  enableAutoPipelining: true,
  maxRetriesPerRequest: 3,
});
redis.on('error', () => undefined);

const requireAuth = createJwtVerifier({
  jwksUrl: process.env.AUTH_JWKS_URL || 'http://localhost:3001/.well-known/jwks.json',
});

let consumerRunning = false;

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: (process.env.FRONTEND_URL || 'http://localhost:3000').split(','), credentials: true }));
app.use(express.json({ limit: '8kb' }));

const { middleware } = setupMetrics(app, 'notification-service', {
  readinessChecks: { kafka: () => consumerRunning, redis: () => redis.status === 'ready' },
});
app.use(middleware);

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', service: 'notification-service' }, error: null });
});

// The in-app notification inbox is not implemented yet; these are auth-gated stubs.
app.get('/api/v1/notifications', requireAuth, (_req, res) => {
  res.json({ success: true, data: [], error: null });
});
app.patch('/api/v1/notifications/read-all', requireAuth, (_req, res) => {
  res.json({ success: true, data: null, error: null });
});

async function start() {
  const server = app.listen(PORT, () => console.log(`notification-service listening on ${PORT}`));
  let kafka: Awaited<ReturnType<typeof startConsumer>> | null = null;

  registerGracefulShutdown(server, async () => {
    await kafka?.consumer.disconnect().catch(() => undefined);
    await kafka?.producer.disconnect().catch(() => undefined);
    closeEmail();
    await redis.quit().catch(() => undefined);
  });

  // Keep retrying Kafka in the background instead of crash-looping the pod.
  for (let attempt = 1; !kafka; attempt++) {
    try {
      kafka = await startConsumer(redis);
      consumerRunning = true;
      kafka.consumer.on(kafka.consumer.events.CRASH, () => {
        consumerRunning = false;
      });
    } catch (err) {
      console.error(`Kafka consumer start failed (attempt ${attempt})`, (err as Error).message);
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
    }
  }
}

void start();
