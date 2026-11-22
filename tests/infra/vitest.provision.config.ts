import { defineConfig } from 'vitest/config';

// POLY-97 (architect's CI remedy, pins-review @ 5b2a5e90): the provisioning dry run. Runs in the `provision` job:
//   pnpm exec vitest run -c tests/infra/vitest.provision.config.ts
// Needs a Docker daemon; builds tests/infra/provision/Dockerfile itself. No credential, no provider network, no built app image.
// The three files are independent (own snapshots, containers and network names), so they run side by side.
export default defineConfig({
  test: {
    include: ['tests/infra/provision/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: true,
    maxWorkers: 3,
  },
});
