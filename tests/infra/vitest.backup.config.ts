import { defineConfig } from 'vitest/config';

// POLY-99 (architect, ruling Guards @ 2bf5a6ba): the backup/uploader/restore/drill container suite. ONE stack, fake-b2 and real set for the whole run
// (globalSetup); files run one after another. Runs in the existing `image` job as one more step, only when the `backup` change key is true:
//   pnpm exec vitest run -c tests/infra/vitest.backup.config.ts
// Needs Docker, `age`, `pg_restore` and python3 on the host. The fixed subnets mean no other container suite may run beside it.
export default defineConfig({
  test: {
    include: ['tests/infra/backup/*.test.ts'],
    globalSetup: ['tests/infra/backup/global-setup.ts'],
    testTimeout: 300_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
});
