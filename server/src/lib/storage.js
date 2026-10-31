// S3-compatible file storage (MinIO locally). Downloads use short-lived signed
// URLs, generated only after the caller's permission check (FR-FILE-04).
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

const { storage } = config;

export const s3 = new S3Client({
  endpoint: storage.endpoint,
  region: storage.region,
  forcePathStyle: true, // MinIO serves buckets by path, not subdomain
  credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
});

// Signed links must name the host the browser uses (S3_PUBLIC_ENDPOINT in production)
const signer =
  storage.publicEndpoint === storage.endpoint
    ? s3
    : new S3Client({
        endpoint: storage.publicEndpoint,
        region: storage.region,
        forcePathStyle: true,
        credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
      });

const contentDisposition = (filename, inline) =>
  `${inline ? 'inline' : 'attachment'}${filename ? `; filename*=UTF-8''${encodeURIComponent(filename)}` : ''}`;

/**
 * FR-FILE-04: signed GET link for a project file version, valid SIGNED_URL_TTL_SECONDS.
 * Call only after the permission and scan checks. `signingDate` exists for tests (TC-FILE-003).
 */
export async function getFileUrl(key, { filename, inline = false, contentType, signingDate } = {}) {
  const command = new GetObjectCommand({
    Bucket: storage.bucket,
    Key: key,
    ResponseContentDisposition: contentDisposition(filename, inline),
    ...(contentType ? { ResponseContentType: contentType } : {}),
  });
  const signedAt = signingDate ?? new Date();
  const url = await getSignedUrl(signer, command, { expiresIn: storage.signedUrlTtlSeconds, signingDate: signedAt });
  return { url, expires_at: new Date(signedAt.getTime() + storage.signedUrlTtlSeconds * 1000).toISOString() };
}

/** Stream an upload of unknown chunking into one object (multipart for large files). */
export async function uploadStream(key, body, contentType) {
  const upload = new Upload({ client: s3, params: { Bucket: storage.bucket, Key: key, Body: body, ContentType: contentType }, queueSize: 4, partSize: 8 * 1024 * 1024 });
  await upload.done();
}

/** Read an object back as a Node stream (virus scanning). */
export async function getObjectStream(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }));
  return res.Body;
}

/**
 * Signed GET URL for one object, valid SIGNED_URL_TTL_SECONDS (default 600 = 10 min).
 * Call this only after checking the user may read the file.
 */
export function getDownloadUrl(key, { filename, inline = false } = {}) {
  const command = new GetObjectCommand({
    Bucket: storage.bucket,
    Key: key,
    ResponseContentDisposition: inline
      ? 'inline'
      : filename
        ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
        : undefined,
  });
  return getSignedUrl(s3, command, { expiresIn: storage.signedUrlTtlSeconds });
}

/** Store one object. */
export async function putObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: body, ContentType: contentType }));
}

/** Remove one object (no error if it is already gone). */
export async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }));
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
