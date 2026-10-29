import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the production build: the bundled API serves the built web app on one
 * origin against a real PostgreSQL database (`pnpm build` first). Files named *.desktop.spec.ts
 * or *.mobile.spec.ts run only on those projects; everything else runs everywhere.
 */
const PORT = 4100;
export const E2E_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://pump:pump_local_only@localhost:55432/pump_test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Each test drives a real browser against one API process; more workers than this saturate
  // a laptop and only measure CPU contention.
  workers: process.env.CI ? 2 : 4,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT.toString()}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /\.mobile\.spec\.ts$/,
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testIgnore: /\.desktop\.spec\.ts$/,
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'] },
      testIgnore: /\.desktop\.spec\.ts$/,
    },
  ],
  webServer: {
    command: 'node ../api/dist/migrate.js && node ../api/dist/server.js',
    url: `http://localhost:${PORT.toString()}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      PORT: PORT.toString(),
      DATABASE_URL: E2E_DATABASE_URL,
      WEB_DIST_DIR: fileURLToPath(new URL('./dist', import.meta.url)),
      LOG_LEVEL: 'warn',
      RATE_LIMIT_PER_MINUTE: '100000',
      SESSIONS_PER_HOUR_PER_IP: '100000',
    },
  },
});
