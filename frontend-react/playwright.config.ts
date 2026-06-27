import { defineConfig, devices } from '@playwright/test';

// E2E config for Diyar HR. Runs against the LIVE Docker stack (frontend :3001 →
// n8n :5678 → postgres/ollama/sidecars). There is NO test DB — tests write to the
// production `hr_automation` DB using clearly-labelled data ("QA …(TEST)",
// qa.*@example.com) that global teardown deletes by label. See tests/README.md.
//
// AI steps (JD generation, CV/interview evaluation) call Ollama on CPU and take
// 60–120s each, so timeouts are deliberately generous and workers=1 (the shared
// DB + single Ollama instance make parallelism unsafe).
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,            // per-test: room for multiple slow Ollama calls
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'tests/report', open: 'never' }],
  ],
  outputDir: 'tests/results',
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    screenshot: 'on',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    // PW_SLOMO=700 (with --headed) slows each action so a human can follow the
    // real Chrome window. 0 by default so the normal headless suite stays fast.
    launchOptions: { slowMo: process.env.PW_SLOMO ? Number(process.env.PW_SLOMO) : 0 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  globalTeardown: './tests/global-teardown.ts',
});
