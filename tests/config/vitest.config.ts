import { defineConfig } from 'vitest/config';

// POLY-85 suites that need no database: pnpm vitest run -c tests/config/vitest.config.ts
// (the Postgres-backed ops-status suite lives in tests/db and runs under tests/db/vitest.config.ts)
export default defineConfig({
  test: {
    include: ['tests/config/**/*.test.ts', 'tests/image/**/*.test.ts', 'tests/log/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
