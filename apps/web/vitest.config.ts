import { defineConfig } from 'vitest/config';

// POLY-128 R1: Playwright's tests/e2e/*.spec.ts never runs under vitest.
// The tests need no SvelteKit types; `tsconfig.json` extends the `$app/tsconfig` that `svelte-kit sync` generates,
// which a fresh checkout lacks, so the transform is told not to read any tsconfig.
export default defineConfig({
  // vite 8 reads this at runtime; its OxcOptions type does not list it yet.
  oxc: { tsconfig: false } as never,
  test: { include: ['src/**/*.test.ts'] },
});
