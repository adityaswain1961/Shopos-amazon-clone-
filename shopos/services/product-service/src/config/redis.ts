import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (redisClient) return redisClient;

  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 3000);
      return delay;
    },
    lazyConnect: true,
  });

  redisClient.on('connect', () => {
    logger.info('✅ Redis connected successfully');
  });

  redisClient.on('error', (err) => {
    logger.error('Redis connection error', { error: err.message });
  });

  redisClient.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return redisClient;
}

export async function connectRedis(): Promise<void> {
  const client = getRedisClient();
  await client.connect();
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis disconnected gracefully');
  }
}
