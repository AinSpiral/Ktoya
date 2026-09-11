import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/forest-visual.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: { channel: 'chrome', baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure', actionTimeout: 15_000, navigationTimeout: 20_000 },
  webServer: {
    command: 'pnpm exec vite --config e2e/vite.config.ts --host 127.0.0.1 --port 3100 --strictPort',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_SEND_METRICS: 'false' },
  },
});
