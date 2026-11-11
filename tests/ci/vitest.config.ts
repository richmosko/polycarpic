import { defineConfig } from 'vitest/config';

// POLY-96: the CI scripts and workflow-structure suite. Runs in the `lint` job when `ci` changed:
//   pnpm vitest run -c tests/ci/vitest.config.ts
// Needs no Docker, no network, no database.
export default defineConfig({
  test: {
    include: ['tests/ci/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
