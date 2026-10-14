import { defineConfig } from '@playwright/test';

// PW_PORT lets two agents run suites side by side without sharing (and then
// killing) one Vite server. Default stays 5193.
const port = Number(process.env.PW_PORT ?? 5193);

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  /**
   * Budgets are deliberately generous.
   *
   * A timeout costs nothing on a passing run — it is only ever the ceiling, and
   * an assertion that succeeds in 80ms returns in 80ms whatever the ceiling is.
   * What a tight ceiling buys is a faster *failure*, and it charges for that by
   * failing correct-but-slow runs. This suite is normally ~2.5 minutes but has
   * hit 4.5 under load (a dev server and a browser running alongside it), and
   * that margin is what used to fail a handful of text tests.
   *
   * Retries are deliberately NOT enabled: a retry would paper over a genuine
   * intermittent bug by turning it into a green run, which is the opposite of
   * what this suite is for.
   */
  timeout: 30000,
  retries: 0,
  expect: { timeout: 10000 },
  use: {
    // Dedicated test port — avoids colliding with other Vite apps on 5173
    baseURL: `http://localhost:${port}`,
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10000,
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
