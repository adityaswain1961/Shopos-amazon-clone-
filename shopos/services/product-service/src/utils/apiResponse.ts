import type { Response } from 'express';
import type { ApiResponse } from '@shopos/shared-types';

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode: number = 200,
  meta?: Record<string, unknown>,
): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
    error: null,
    ...(meta && { meta }),
  };
  res.status(statusCode).json(response);
}

export function sendError(
  res: Response,
  error: string,
  statusCode: number = 400,
  meta?: Record<string, unknown>,
): void {
  const response: ApiResponse<null> = {
    success: false,
    data: null,
    error,
    ...(meta && { meta }),
  };
  res.status(statusCode).json(response);
}
