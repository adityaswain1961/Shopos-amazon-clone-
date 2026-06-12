import multer from 'multer';
import { sendError } from '../utils/apiResponse.js';
import type { Request } from 'express';

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Multer middleware for avatar upload.
 * - Memory storage (buffer — we process with sharp before S3 upload)
 * - File filter: only jpg, png, webp
 * - Size limit: 5 MB
 */
export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (_req: Request, file, cb) => {
    if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'avatar'));
    }
  },
}).single('avatar');

/**
 * Wrap multer to return clean API errors instead of raw multer errors.
 */
export function handleAvatarUpload(
  req: Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  avatarUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        sendError(res, 'File too large. Maximum size is 5 MB.', 400);
        return;
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        sendError(res, 'Invalid file type. Only JPEG, PNG, and WebP are allowed.', 400);
        return;
      }
      sendError(res, `Upload error: ${err.message}`, 400);
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}
