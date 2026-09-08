import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  forbidOnly: !!process.env.CI,
  testDir: './tests',
  testMatch: 'package.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'line',
  outputDir: 'test-results/package',
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
});
