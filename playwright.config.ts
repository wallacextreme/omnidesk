import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--allow-file-access-from-files",
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: "bun run server/signaling.ts",
      url: "http://localhost:4000/health",
      timeout: 20000,
      reuseExistingServer: true,
    },
    {
      command: "bun run dev",
      url: "http://localhost:5173",
      timeout: 20000,
      reuseExistingServer: true,
    },
  ],
});
