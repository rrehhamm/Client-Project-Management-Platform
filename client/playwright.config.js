import { defineConfig, devices } from '@playwright/test';

// E2E tests run the real API and a production build of the client.
// The database, storage and mail must be up (npm run setup).
// The API uses its own database (cpm_e2e), wiped and seeded at the start of every run,
// so browser tests never write to the dev database.
// The API runs on its own port, so a running `npm run dev` (port 4000) is not reused.
// Specs sign in as the same seeded users in parallel, so rate limits are raised for this API only.
const API_PORT = process.env.E2E_API_PORT ?? '4100';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run e2e:server -w server',
      cwd: '..',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      // The stub scanner marks uploads clean (and flags EICAR), so files can be opened (D-30)
      env: { API_PORT, AUTH_RATE_LIMIT_PER_MINUTE: '200', API_RATE_LIMIT_PER_MINUTE: '2000', SCANNER: 'stub' },
      // Never reuse: every run must start from a freshly seeded database
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run build && npm run preview',
      url: 'http://localhost:4173',
      env: { API_PORT },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
