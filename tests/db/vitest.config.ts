import { defineConfig } from 'vitest/config';

// Run: pnpm vitest run -c tests/db/vitest.config.ts   (Docker, or POLY_TEST_PG_URL pointing at a pgtap-enabled server)
//
// Two projects in one invocation (POLY-141): every file runs in parallel (db-parallel) except SERIAL, which runs
// afterwards, one file at a time (db-serial). The cluster-wide `roles.sql` step is serialised across workers by
// helpers/bootstrap-lock.ts, so parallel files never collide on it. globalSetup stays at the root: one container.
//
// SERIAL files write or read cluster-wide state, or are timing-sensitive under contention:
//   runner         role-membership GRANT/REVOKE and cluster-wide pg_locks reads
//   template-clone asserts the login roles' stored password hashes
//   ops-hardening  a 4.8 s production timeout, not measured under contention
export const SERIAL = ['tests/db/runner.test.ts', 'tests/db/template-clone.test.ts', 'tests/db/ops-hardening.test.ts'];

export default defineConfig({
  test: {
    globalSetup: ['tests/db/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    // 4 vCPU on the CI runner, one left for Postgres; pinned so a local run has the CI shape.
    maxWorkers: 3,
    projects: [
      {
        extends: true,
        test: {
          name: 'db-parallel',
          include: ['tests/db/**/*.test.ts'],
          exclude: SERIAL,
          fileParallelism: true,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'db-serial',
          include: SERIAL,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
