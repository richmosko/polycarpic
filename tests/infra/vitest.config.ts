import { defineConfig } from 'vitest/config';

// POLY-95 R3: the compose-policy lint fixtures + static wiring checks. Runs in the existing `lint` job when
// `image == 'true' || ci == 'true'`:   pnpm exec vitest run -c tests/infra/vitest.config.ts
// Needs the `docker compose` CLI (renders config) but no daemon, no network.
export default defineConfig({
  test: {
    include: ['tests/infra/*.test.ts'],
    testTimeout: 30_000,
    maxConcurrency: 4, // POLY-95 A2: the runner's vCPUs; the lint fixtures run concurrently
  },
});
