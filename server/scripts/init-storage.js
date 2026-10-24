// Creates the S3 bucket if missing. Run by `npm run setup`.
import { config } from '../src/config.js';
import { ensureBucket } from '../src/lib/storage.js';

try {
  const created = await ensureBucket();
  console.log(created ? `Created bucket "${config.storage.bucket}"` : `Bucket "${config.storage.bucket}" already exists`);
} catch (err) {
  // Connection errors from the AWS SDK can have an empty message (AggregateError)
  const reason = err.message || err.code || err.name || 'unknown error';
  console.error(`Could not reach storage at ${config.storage.endpoint}: ${reason}`);
  process.exit(1);
}
