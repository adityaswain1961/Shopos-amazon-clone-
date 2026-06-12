import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Correlation ID middleware.
 * Extracts X-Correlation-Id from request header (injected by Kong gateway)
 * or generates a new UUID if not present.
 * Attaches to request and response headers.
 */
export function correlationId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const id = (req.headers['x-correlation-id'] as string) || uuidv4();

  req.correlationId = id;
  res.set('X-Correlation-Id', id);

  next();
}
