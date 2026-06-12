import sharp from 'sharp';
import { UserProfile } from '../models/UserProfile.js';
import { uploadToS3 } from '../config/s3.js';
import { invalidateProfileCache } from './profileService.js';
import { AppError } from '../utils/appError.js';
import { logger } from '../utils/logger.js';

const AVATAR_SIZE = 400;
const AVATAR_QUALITY = 85;

/**
 * Process and upload a user avatar:
 * 1. Resize to 400×400 using sharp (cover mode)
 * 2. Convert to WebP format
 * 3. Upload to S3 at avatars/{userId}.webp
 * 4. Update profile.avatarUrl with CDN URL
 * 5. Invalidate Redis cache
 */
export async function processAndUploadAvatar(
  userId: string,
  fileBuffer: Buffer,
): Promise<string> {
  // Resize and convert to WebP
  const processedBuffer = await sharp(fileBuffer)
    .resize(AVATAR_SIZE, AVATAR_SIZE, {
      fit: 'cover',
      position: 'centre',
    })
    .webp({ quality: AVATAR_QUALITY })
    .toBuffer();

  // Upload to S3
  const key = `avatars/${userId}.webp`;
  const cdnUrl = await uploadToS3(key, processedBuffer, 'image/webp');

  // Update profile
  const profile = await UserProfile.findOne({ userId, isDeleted: false });
  if (!profile) {
    throw new AppError('Profile not found', 404);
  }

  profile.avatarUrl = cdnUrl;
  await profile.save();

  // Invalidate cache
  await invalidateProfileCache(userId);

  logger.info('Avatar uploaded and processed', { userId, cdnUrl });
  return cdnUrl;
}
