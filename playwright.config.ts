import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', workers: 1, fullyParallel: false, timeout: 30000,
  reporter: [['list'], ['json', { outputFile: (process.env.EVIDENCE_DIR || 'docs/evidence/latest') + '/e2e-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5179', channel: 'chrome', viewport: { width: 1440, height: 1100 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:5179', reuseExistingServer: false, timeout: 60000 },
  outputDir: 'test-results'
});
