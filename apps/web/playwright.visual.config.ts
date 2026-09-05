import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/forest-visual.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'outputs/forest-art/final/test-results.json' }]],
  use: {
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:3101',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite --config e2e/vite.config.ts --host 127.0.0.1 --port 3101 --strictPort',
    url: 'http://127.0.0.1:3101',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
      WRANGLER_SEND_METRICS: 'false',
      KTOYA_AI_TRIAL_ENABLED: 'false',
      KTOYA_AI_API_KEY: '',
      KTOYA_SPEECHKIT_TRIAL_ENABLED: 'false',
      YANDEX_SPEECHKIT_API_KEY: '',
    },
  },
});
