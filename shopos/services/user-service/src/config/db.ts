import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(env.MONGO_URI, {
    // Per-replica pool. Total connections = replicas × pool — keep
    // (maxReplicas × MONGO_MAX_POOL_SIZE) below your MongoDB connection limit.
    maxPoolSize: env.MONGO_MAX_POOL_SIZE,
    minPoolSize: Math.min(5, env.MONGO_MAX_POOL_SIZE),
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    // Indexes are created by deploy/migration, not by every pod on boot.
    autoIndex: env.NODE_ENV !== 'production',
  });

  logger.info('MongoDB connected');

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { error: err.message });
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
}

export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
