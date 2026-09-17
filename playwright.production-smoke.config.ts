import { defineConfig, devices } from "@playwright/test";

const baseURL = (process.env.PLAYWRIGHT_BASE_URL ?? "https://www.meethint.ai").replace(/\/$/, "");

/** Production smoke — no local dev server; uses saved Google OAuth storage state. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["production-smoke-preauth.spec.ts", "production-smoke.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 900_000,
  reporter: [["list"], ["json", { outputFile: ".grok/production-smoke-playwright.json" }]],
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        // Match capture-smoke-auth.mjs — Google OAuth rejects bundled Chromium.
        channel: "chrome",
        launchOptions: {
          args: ["--disable-blink-features=AutomationControlled"],
        },
        baseURL,
        trace: "retain-on-failure",
        permissions: ["clipboard-read", "clipboard-write"],
      },
    },
  ],
});
