import { defineConfig } from 'vitest/config';

// POLY-128 R1: Playwright's tests/e2e/*.spec.ts never runs under vitest.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
