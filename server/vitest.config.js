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
    },
  },
});
