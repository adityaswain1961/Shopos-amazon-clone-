/**
 * Custom application error with HTTP status code.
 * Extracted as a shared utility so all services can use it.
 */
export class AppError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}
