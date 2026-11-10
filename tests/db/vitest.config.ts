import { defineConfig } from 'vitest/config';

// Run: pnpm vitest run -c tests/db/vitest.config.ts   (Docker, or POLY_TEST_PG_URL pointing at a pgtap-enabled server)
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
