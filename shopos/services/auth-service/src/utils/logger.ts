import winston from 'winston';
import { env } from '../config/env.js';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, correlationId, ...meta }) => {
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  const corrId = correlationId ? ` [${correlationId}]` : '';
  return `${ts} [${level}]${corrId} ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    logFormat,
  ),
  defaultMeta: { service: 'auth-service' },
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        logFormat,
      ),
    }),
  ],
});

/**
 * Create a child logger with a correlation ID attached.
 */
export function createCorrelationLogger(correlationId: string) {
  return logger.child({ correlationId });
}
