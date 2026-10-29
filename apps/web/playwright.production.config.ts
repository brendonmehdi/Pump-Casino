import { defineConfig } from '@playwright/test';
import { BROWSER_PROJECTS } from './playwright.config';

/**
 * Smoke tests against a deployed site (e2e/*.smoke.ts): no local server and no database
 * access, so every round is real. Run from apps/web with
 *   PUMP_BASE_URL=https://<host> pnpm exec playwright test -c playwright.production.config.ts
 */
const baseURL = process.env.PUMP_BASE_URL;
if (!baseURL) throw new Error('Set PUMP_BASE_URL to the deployed site, e.g. https://<host>');

export default defineConfig({
  testDir: 'e2e',
  testMatch: /\.smoke\.ts$/,
  fullyParallel: true,
  retries: 0,
  workers: 3,
  // An idle free instance can take about a minute to wake up for the first request.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: BROWSER_PROJECTS,
});
