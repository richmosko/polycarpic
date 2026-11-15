import { defineConfig } from 'vitest/config';

// POLY-147 R7: the marker measurement. Not matched by tests/db/**/*.test.ts, so the suite never runs it.
// Run: POLY_TEST_PG_URL=<superuser url of a pgtap-enabled server> BENCH_TREE=branch|control BENCH_OUT=<file> \
//        pnpm vitest run -c tests/db/bench/vitest.config.ts --exclude '.claude/**'
// The control run is the same files copied into a git worktree of origin/main, against the same server.
export default defineConfig({
  test: {
    globalSetup: ['tests/db/bench/global-setup.ts'],
    include: ['tests/db/bench/**/*.bench.ts'],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
