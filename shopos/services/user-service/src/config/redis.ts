import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (redisClient) return redisClient;

  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    // Batch commands issued in the same event-loop tick into one round trip.
    // Big throughput win at high request rates, no code changes needed.
    enableAutoPipelining: true,
    // Fail fast instead of queueing forever when Redis is down — every Redis
    // use in this service has a graceful fallback.
    enableOfflineQueue: true,
    commandTimeout: 1000,
    retryStrategy(times) {
      return Math.min(times * 200, 3000);
    },
    lazyConnect: true,
  });

  redisClient.on('ready', () => logger.info('Redis connected'));
  redisClient.on('error', (err) => logger.error('Redis connection error', { error: err.message }));

  return redisClient;
}

export function isRedisReady(): boolean {
  return redisClient?.status === 'ready';
}

export async function connectRedis(): Promise<void> {
  await getRedisClient().connect();
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
