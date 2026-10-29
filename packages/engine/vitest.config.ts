import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The 100k-round simulation and the exhaustive bet sweep are CPU-bound by design.
    testTimeout: 120_000,
  },
});
