import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["dot"], ["html", { open: "never" }]]
    : "list",
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: process.env.FINDSPOT_BASE_URL ?? "http://127.0.0.1:5174/findspot/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: ["--no-sandbox"],
        }
      : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["geolocation"],
        geolocation: { latitude: 53.3811, longitude: -1.4701 },
      },
    },
  ],
  webServer: process.env.FINDSPOT_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1 --port 5174",
        url: "http://127.0.0.1:5174/findspot/",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
