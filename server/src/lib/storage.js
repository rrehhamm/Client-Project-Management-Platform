// S3-compatible file storage (MinIO locally). Downloads use short-lived signed
// URLs, generated only after the caller's permission check (FR-FILE-04).
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

const { storage } = config;

export const s3 = new S3Client({
  endpoint: storage.endpoint,
  region: storage.region,
  forcePathStyle: true, // MinIO serves buckets by path, not subdomain
  credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
});

/**
 * Signed GET URL for one object, valid SIGNED_URL_TTL_SECONDS (default 600 = 10 min).
 * Call this only after checking the user may read the file.
 */
export function getDownloadUrl(key, { filename } = {}) {
  const command = new GetObjectCommand({
    Bucket: storage.bucket,
    Key: key,
    ResponseContentDisposition: filename
      ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      : undefined,
  });
  return getSignedUrl(s3, command, { expiresIn: storage.signedUrlTtlSeconds });
}

/** Readiness probe: true when the bucket is reachable. */
export async function pingStorage() {
  await s3.send(new HeadBucketCommand({ Bucket: storage.bucket }));
  return true;
}

/** Create the bucket if it does not exist yet. Used by `npm run setup`. */
export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: storage.bucket }));
    return false;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode !== 404) throw err;
  }
  await s3.send(new CreateBucketCommand({ Bucket: storage.bucket }));
  return true;
}
