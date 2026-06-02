import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    // Stub Express backend — replaces the real backend on port 3000 so the
    // YouTube channel route code is exercised without hitting the real
    // YouTube API or requiring a MongoDB connection.
    {
      command: 'npx tsx tests/helpers/run-stub-backend.ts',
      cwd: '../backend',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 10000,
    },
    // Vite dev server (port 5173) — proxies /api and /health to the stub backend.
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 10000,
    },
  ],
})
