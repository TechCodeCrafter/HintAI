import { defineConfig, devices } from "@playwright/test";

import { E2E_PREVIEW_BOOT, E2E_PREVIEW_URL } from "./scripts/e2e-preview-shared.mjs";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? E2E_PREVIEW_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  use: {
    baseURL,
    trace: "on-first-retry",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: E2E_PREVIEW_BOOT,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
});
