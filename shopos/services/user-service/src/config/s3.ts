import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let s3Client: S3Client | null = null;

/**
 * Get or create the S3 client singleton.
 */
export function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  s3Client = new S3Client({
    region: env.AWS_S3_REGION,
    ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });

  return s3Client;
}

/**
 * Upload a file buffer to S3 and return the CDN URL.
 */
export async function uploadToS3(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  const cdnUrl = `${env.CDN_BASE_URL}/${key}`;
  logger.info('File uploaded to S3', { key, cdnUrl });
  return cdnUrl;
}
