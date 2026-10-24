import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadEnv({ path: resolve(import.meta.dirname, '../.env'), quiet: true });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'prisma/**/*.test.js'],
    globalSetup: ['./test/global-setup.js'],
    // Tests share one seeded database; run files one at a time.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      // Low bcrypt cost keeps hundreds of password checks fast (allowed in test only).
      BCRYPT_COST: '4',
      // Supertest talks plain HTTP, so cookies must not carry the Secure flag here.
      COOKIE_SECURE: 'false',
      // Rate limits are tested with a dedicated app instance.
      AUTH_RATE_LIMIT_PER_MINUTE: '100000',
      API_RATE_LIMIT_PER_MINUTE: '100000',
    },
  },
});
