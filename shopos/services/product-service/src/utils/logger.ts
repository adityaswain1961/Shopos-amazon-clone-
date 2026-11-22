import winston from 'winston';
import { env } from '../config/env.js';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const SERVICE = 'product-service';

const devFormat = printf(({ level, message, timestamp: ts, correlationId, service: _s, ...meta }) => {
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  const corrId = correlationId ? ` [${correlationId}]` : '';
  return `${ts} [${level}]${corrId} ${message}${metaStr}`;
});

// Production: one JSON object per line (cheap to ship & query in Loki).
// Development: human readable, coloured.
export const logger = winston.createLogger({
  level: env.LOG_LEVEL || (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  defaultMeta: { service: SERVICE },
  format:
    env.NODE_ENV === 'production'
      ? combine(errors({ stack: true }), timestamp(), json())
      : combine(errors({ stack: true }), colorize(), timestamp({ format: 'HH:mm:ss.SSS' }), devFormat),
  transports: [new winston.transports.Console()],
});

export function createCorrelationLogger(correlationId: string) {
  return logger.child({ correlationId });
}
