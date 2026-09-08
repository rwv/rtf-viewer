import { defineConfig, devices } from '@playwright/test';

/**
 * The layout and paint baseline. One engine, because a benchmark comparing three browsers to
 * each other measures the browsers, and one worker, because two measurements sharing a machine
 * measure the machine.
 */
export default defineConfig({
  forbidOnly: !!process.env.CI,
  testDir: './tests',
  testMatch: 'bench.spec.ts',
  timeout: 600_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'pnpm --filter @rtf-viewer/example preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
