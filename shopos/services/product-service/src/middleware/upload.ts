import multer from 'multer';
import { sendError } from '../utils/apiResponse.js';
import type { Request, Response, NextFunction } from 'express';

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export const productImagesUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5,
  },
  fileFilter: (_req: Request, file, cb) => {
    if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'images'));
    }
  },
}).array('images', 5);

export function handleImagesUpload(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  productImagesUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        sendError(res, 'One or more files are too large. Maximum size is 5 MB per image.', 400);
        return;
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        sendError(res, 'Invalid file structure or type. Only JPEG, PNG, and WebP are allowed (max 5 images).', 400);
        return;
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        sendError(res, 'Too many files uploaded. Maximum is 5 images.', 400);
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
