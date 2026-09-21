import { defineConfig, devices } from '@playwright/test';

/**
 * Spec 13.1: end-to-end on a mobile viewport, against a running stack.
 *
 * Opt-in, because it needs the API, the database and a seeded event. Point it
 * at a deployment and give it the event to use:
 *
 *   E2E_BASE_URL=http://localhost:5173 E2E_EVENT_ID=<id> pnpm --filter @bolsa/web test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      // The product is used on a phone, so that is what it is tested on.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
