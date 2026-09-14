import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

import {
  E2E_PREVIEW_BOOT,
  E2E_PREVIEW_BOOT_AUTH_ON,
  E2E_PREVIEW_URL,
} from "./scripts/e2e-preview-shared.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WHY_RETRY_WAV = path.join(ROOT, "e2e/fixtures/why-retry.wav");
const SILENCE_WAV = path.join(ROOT, "e2e/fixtures/silence-10s.wav");
const NOISE_WAV = path.join(ROOT, "e2e/fixtures/noise-10s.wav");

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
  webServer: {
    command: E2E_PREVIEW_BOOT,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
    env: {
      ...process.env,
      MEETHINT_E2E: "1",
      VITE_E2E: "true",
      VITE_DEBUG_FLIGHT: "true",
    },
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/audio-path.spec.ts",
      grepInvert: /@auth-on/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-funnel-auth-on",
      testMatch: "**/funnel-no-signin.spec.ts",
      grep: /@auth-on/,
      use: { ...devices["Desktop Chrome"] },
      webServer: {
        command: E2E_PREVIEW_BOOT_AUTH_ON,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180000,
        env: {
          ...process.env,
          MEETHINT_E2E: "1",
          VITE_E2E: "true",
          VITE_DEBUG_FLIGHT: "true",
          VITE_AUTH_ENABLED: "true",
        },
      },
    },
    {
      name: "chromium-audio",
      testMatch: "**/audio-path.spec.ts",
      grepInvert: /silence must not trigger|noise must not trigger/,
      retries: process.env.CI ? 2 : 1,
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["clipboard-read", "clipboard-write", "microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-audio-capture=${WHY_RETRY_WAV}`,
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
    {
      name: "chromium-audio-silence",
      testMatch: "**/audio-path.spec.ts",
      grep: /silence must not trigger/,
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["clipboard-read", "clipboard-write", "microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-audio-capture=${SILENCE_WAV}`,
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
    {
      name: "chromium-audio-noise",
      testMatch: "**/audio-path.spec.ts",
      grep: /noise must not trigger/,
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["clipboard-read", "clipboard-write", "microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-audio-capture=${NOISE_WAV}`,
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
  ],
});
