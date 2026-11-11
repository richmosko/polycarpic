import { defineConfig } from 'vitest/config';

// POLY-95 R1/R5/R6/R8: tests that run the real containers. Runs in the existing `image` job:
//   pnpm exec vitest run -c tests/infra/vitest.image.config.ts
// Needs a Docker daemon and the `docker compose` CLI. One compose-run service per file, shared by its tests.
export default defineConfig({
  test: {
    include: ['tests/infra/image/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
