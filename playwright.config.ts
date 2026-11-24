import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 20000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  webServer: process.env.FITIFY_E2E_MANAGED === "1" ? {
    command: "npm run dev:local",
    wait: { stdout: /Fitify is ready at/ },
    timeout: 180000,
    stdout: "pipe",
    stderr: "pipe",
  } : undefined,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
      : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: "list",
});
