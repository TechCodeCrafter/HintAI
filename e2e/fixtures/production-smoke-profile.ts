import fs from "node:fs";
import path from "node:path";

import { chromium, type BrowserContext } from "@playwright/test";

export function smokeBaseURL(): string {
  return (process.env.PLAYWRIGHT_BASE_URL ?? "https://www.meethint.ai").replace(/\/$/, "");
}

export function defaultSmokeProfile(user: "a" | "b"): string {
  const fromEnv = process.env[`MEETHINT_SMOKE_PROFILE_${user.toUpperCase()}`]?.trim();
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), `.grok/smoke-profile-${user}`);
}

export function smokeProfileReady(user: "a" | "b"): boolean {
  return fs.existsSync(defaultSmokeProfile(user));
}

/** Chrome user-data profile — restores __Host- OAuth cookies Playwright storage JSON cannot. */
export async function launchSmokeProfile(user: "a" | "b"): Promise<BrowserContext> {
  const profileDir = defaultSmokeProfile(user);
  if (!fs.existsSync(profileDir)) {
    throw new Error(
      `Missing smoke profile ${profileDir} — run: node scripts/capture-smoke-auth.mjs ${user}`,
    );
  }
  return chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: process.env.MEETHINT_SMOKE_HEADED !== "1",
    args: ["--disable-blink-features=AutomationControlled"],
    baseURL: smokeBaseURL(),
    acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
}
