import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  // A spec that takes a limiter slot (support.ts) may wait up to a minute for the shared bucket to reopen; the wait is the cost of the real limit (R8).
  timeout: 150_000,
  projects: [
    { name: 'chromium', testIgnore: /rate-limit\.spec/, use: { ...devices['Desktop Chrome'] } },
    // POLY-150 R8: the 429 spec runs after the main project, because it uses up the sign-in service's one shared address for a minute.
    { name: 'rate-limit', testMatch: /rate-limit\.spec/, dependencies: ['chromium'], use: { ...devices['Desktop Chrome'] } },
  ],
  // No x-forwarded-for here (POLY-150 R8): the address is set by the proxy in front of the service, and a spec that forges one proves it is ignored.
  // Signed in by default: serve.ts seeds one user and writes this file before the server answers (POLY-86 R10).
  use: { baseURL: `http://localhost:${port}`, storageState: 'tests/e2e/.auth/user.json', actionTimeout: 15_000 },
  webServer: {
    command: 'node tests/e2e/serve.ts',
    port,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
