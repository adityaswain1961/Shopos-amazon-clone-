import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { uploadToS3, deleteFromS3 } from '../config/s3.js';
import { logger } from '../utils/logger.js';

const MAX_IMAGE_DIMENSION = 1200;
const IMAGE_QUALITY = 85;

export async function processAndUploadProductImage(
  productId: string,
  fileBuffer: Buffer,
): Promise<{ url: string; key: string }> {
  // Resize and convert to WebP while maintaining aspect ratio
  const processedBuffer = await sharp(fileBuffer)
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE_QUALITY })
    .toBuffer();

  const imageId = uuidv4();
  const key = `products/${productId}/${imageId}.webp`;

  const url = await uploadToS3(key, processedBuffer, 'image/webp');

  logger.info('Product image uploaded and processed', { productId, key, url });
  return { url, key };
}

export async function deleteProductImage(key: string): Promise<void> {
  await deleteFromS3(key);
  logger.info('Product image deleted from storage', { key });
}
