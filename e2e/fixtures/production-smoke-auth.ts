import type { Page } from "@playwright/test";

import { readSmokeSessionToken } from "./production-smoke-storage";

const BEARER_KEY = "grok-auth.bearer-token";

/** Attach Better Auth bearer from saved session_token (cookie path for Playwright smoke). */
export async function injectSmokeBearerFromStorage(page: Page, storagePath: string) {
  const token = readSmokeSessionToken(storagePath);
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [BEARER_KEY, token] as const,
  );
}
