import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }]
  ],
  use: {
    baseURL: "http://127.0.0.1:5174",
    channel: process.env.PW_CHANNEL || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: {
      slowMo: Number(process.env.PW_SLOW_MO || 40)
    }
  },
  webServer: [
    {
      command: "cd ../backend && npx prisma generate && npx prisma migrate deploy && npm run dev",
      url: "http://127.0.0.1:4101/health",
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        PORT: "4101",
        E2E_TEST_MODE: "true",
        JWT_SECRET:
          process.env.JWT_SECRET ||
          "claim-app-e2e-local-signing-secret-32-characters"
      }
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5174",
      url: "http://127.0.0.1:5174",
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        VITE_API_URL: "http://127.0.0.1:4101"
      }
    }
  ]
});
