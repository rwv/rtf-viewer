import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  forbidOnly: !!process.env.CI,
  testDir: './tests',
  // The benchmark has its own configuration and budget; the correctness gate must not run it.
  testIgnore: ['package.spec.ts', 'bench.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: 'line',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @rtf-viewer/example preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
