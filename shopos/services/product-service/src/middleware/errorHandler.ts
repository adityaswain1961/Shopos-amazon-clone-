import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export function errorHandler(
  err: Error & { statusCode?: number },
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Map well-known Prisma errors to client errors instead of 500s.
  const code = (err as { code?: string }).code;
  let statusCode = err.statusCode || 500;
  if (code === 'P2002') {
    statusCode = 409;
    err.message = 'A product with this slug or SKU already exists';
  } else if (code === 'P2025') {
    statusCode = 404;
    err.message = 'Not found';
  } else if (code === 'P2003') {
    statusCode = 400;
    err.message = 'Referenced record (e.g. category) does not exist';
  }
  const message = statusCode === 500 && env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  const log = statusCode >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log('Request error', {
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    statusCode,
    error: err.message,
    ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
  });

  sendError(res, message, statusCode);
}
