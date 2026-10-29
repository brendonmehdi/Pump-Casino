import { defineConfig } from 'vitest/config';

// Unit tests cover the pure client logic; the UI itself is exercised end to end by Playwright.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
