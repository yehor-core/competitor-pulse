import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: join(import.meta.dirname, 'test-results'),
  // Scenarios share one Source and one mock LLM, so they must not run in parallel.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: join(import.meta.dirname, 'playwright-report') }],
  ],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080', trace: 'retain-on-failure' },
});
