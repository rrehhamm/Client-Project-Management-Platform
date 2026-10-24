// Loads and validates configuration from the repo-root .env (rule 10: no secrets in code).
// The app refuses to start with a clear message if a value is missing or invalid.
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // "false", "true" or a hop count, passed to Express "trust proxy"
  TRUST_PROXY: z.string().default('false'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  FILE_MAX_BYTES: z.coerce.number().int().positive().default(104_857_600),
  STORAGE_QUOTA_BYTES: z.coerce.number().int().positive().default(53_687_091_200),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().min(3),

  BCRYPT_COST: z.coerce.number().int().min(12, 'BCRYPT_COST must be at least 12 (BR-AUTH-02)').default(12),
});

function parseTrustProxy(value) {
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 ? hops : value;
}

function load() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    // Configuration errors must stop the process before anything else runs.
    throw new Error(`Invalid configuration (check .env against .env.example):\n${lines.join('\n')}`);
  }
  const env = result.data;
  return Object.freeze({
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    port: env.API_PORT,
    appUrl: env.APP_URL,
    logLevel: env.LOG_LEVEL,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    databaseUrl: env.DATABASE_URL,
    storage: Object.freeze({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
      signedUrlTtlSeconds: env.SIGNED_URL_TTL_SECONDS,
      fileMaxBytes: env.FILE_MAX_BYTES,
      quotaBytes: env.STORAGE_QUOTA_BYTES,
    }),
    mail: Object.freeze({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.MAIL_FROM,
    }),
    bcryptCost: env.BCRYPT_COST,
  });
}

export const config = load();
