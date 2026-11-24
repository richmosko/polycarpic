// POLY-100 T-real (ruling.md 3765f358): the one real first-deploy of the image job's last step. Files run one after the other, in name order: 1 (first deploy, second poll),
// 2 (the rollback case: separable, the lead may drop it), 3 (S38's sweep of the kept log). Not part of tests/infra/vitest.config.ts: it needs Linux, root and Docker, and changes the runner.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/infra/deploy-real/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false, shuffle: false },
    testTimeout: 15 * 60_000,
    hookTimeout: 15 * 60_000,
    retry: 0, // a product assertion is never retried (ruling, Flakes)
    reporters: ['default'],
  },
});
