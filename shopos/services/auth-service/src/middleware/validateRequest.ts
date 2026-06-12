import type { Request, Response, NextFunction } from 'express';
import { type ZodSchema, ZodError } from 'zod';
import { sendError } from '../utils/apiResponse.js';

interface ValidationTarget {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Generic zod validation middleware.
 * Validates request body, query, and/or params against provided schemas.
 */
export function validateRequest(schemas: ValidationTarget) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as Record<string, string>;
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as Record<string, string>;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors.map((e) => {
          const path = e.path.join('.');
          return path ? `${path}: ${e.message}` : e.message;
        });
        sendError(res, `Validation error: ${messages.join('; ')}`, 400);
        return;
      }
      next(error);
    }
  };
}
