import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Signed in by default: serve.ts seeds one user and writes this file before the server answers (POLY-86 R10).
  use: { baseURL: `http://localhost:${port}`, storageState: 'tests/e2e/.auth/user.json', extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.7' } },
  webServer: {
    command: 'node tests/e2e/serve.ts',
    port,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
