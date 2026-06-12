import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let s3Client: S3Client | null = null;

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

export async function deleteFromS3(key: string): Promise<void> {
  const client = getS3Client();

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: env.AWS_S3_BUCKET,
        Key: key,
      }),
    );
    logger.info('File deleted from S3', { key });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to delete file from S3', { key, error: message });
  }
}
