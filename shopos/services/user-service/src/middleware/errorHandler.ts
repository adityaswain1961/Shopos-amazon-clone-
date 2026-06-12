import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Global error handler middleware.
 * Catches all errors and returns them in the standard ApiResponse format.
 * Never exposes stack traces in production.
 */
export function errorHandler(
  err: Error & { statusCode?: number },
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode || 500;
  const message = statusCode === 500 && env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  // Log the full error internally
  logger.error('Request error', {
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    statusCode,
    error: err.message,
    ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
  });

  sendError(res, message, statusCode);
}
