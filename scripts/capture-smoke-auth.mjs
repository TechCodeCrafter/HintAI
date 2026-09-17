#!/usr/bin/env node
/**
 * Capture production Google OAuth in a persistent Chrome profile (Playwright).
 *
 * Storage-state JSON alone cannot restore __Host- Better Auth cookies reliably;
 * the smoke harness reads the Chrome profile at `.grok/smoke-profile-{a|b}`.
 *
 * Usage:
 *   node scripts/capture-smoke-auth.mjs a
 *   node scripts/capture-smoke-auth.mjs b
 *   node scripts/capture-smoke-auth.mjs b --fresh
 *
 * Prerequisites:
 *   Google Chrome installed (Playwright channel "chrome").
 *   Smoke Google accounts A/B must be OAuth "Test users" in Google Cloud console.
 *   Do not add an LLM API key before capture — inject via MEETHINT_SMOKE_OPENAI_API_KEY at smoke runtime.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

import { sanitizeStorageStateFile } from "./production-smoke-sanitize.mjs";
import { readProfileSession } from "./smoke-session.mjs";
import { isMainModule, projectRoot } from "./with-app-env.mjs";

const baseURL = (process.env.PLAYWRIGHT_BASE_URL ?? "https://www.meethint.ai").replace(/\/$/, "");
const homeURL = `${baseURL}/home`;
/** Manual headed capture — allow Google 2FA / account verification. */
const MANUAL_HOME_TIMEOUT_MS = 10 * 60 * 1000;
const HOME_POLL_MS = 2_000;

/** Hostname + path only — never log OAuth query strings or tokens. */
function safeLocation(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(unknown location)";
  }
}

function isMeetHintHome(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("meethint.ai") && parsed.pathname.startsWith("/home");
  } catch {
    return false;
  }
}

async function readPageSession(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session", { credentials: "include" });
    return response.json();
  });
}

async function verifySession(page, label) {
  const session = await readPageSession(page);
  const email = session?.user?.email;
  const id = session?.user?.id;
  if (!email || !id) {
    throw new Error(
      `${label} — /api/auth/get-session returned null after /home. Re-sign in and capture again.`,
    );
  }
  return { email, id };
}

function assertDistinctFromUserA(session, sessionA) {
  if (!sessionA?.email || !sessionA?.id) return;
  if (session.email === sessionA.email || session.id === sessionA.id) {
    throw new Error(
      `User B must be a different Google account than User A (${sessionA.email}). Sign out in Chrome and use the other smoke test user.`,
    );
  }
}

/**
 * Poll until MeetHint /home is visible — stays on Google challenge/2FA as long as needed (up to 10 min).
 */
async function waitForManualHome(page) {
  console.log(`>>> Complete Google sign-in and wait until ${homeURL} is visible.`);
  console.log(
    `>>> You have up to 10 minutes. Google challenge / 2FA / account verification is OK — keep going.`,
  );

  const deadline = Date.now() + MANUAL_HOME_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isMeetHintHome(page.url())) return;
    await page.waitForTimeout(HOME_POLL_MS);
  }

  throw new Error(`Timed out after 10 minutes waiting for /home (current: ${safeLocation(page.url())})`);
}

async function startProductionGoogleSignIn(page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const onLogin = await page.getByTestId("login-page").isVisible().catch(() => false);
  if (!onLogin) return;

  const googleButton = page.getByTestId("login-oauth-google");
  if (await googleButton.isVisible().catch(() => false)) {
    await googleButton.click();
  }
}

async function signOutIfSameAsUserA(page, sessionA) {
  if (!sessionA?.email) return;

  const current = await readPageSession(page);
  if (current?.user?.email !== sessionA.email && current?.user?.id !== sessionA.id) return;

  console.log(
    `[capture-smoke-auth] User B profile still signed in as User A (${sessionA.email}) — signing out…`,
  );
  await page.evaluate(async () => {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
}

async function main() {
  const fresh = process.argv.includes("--fresh");
  const user = (process.argv.find((arg) => arg === "a" || arg === "b") ?? "a").toLowerCase();
  if (user !== "a" && user !== "b") {
    console.error("Usage: node scripts/capture-smoke-auth.mjs a|b [--fresh]");
    process.exit(1);
  }

  const outDir = join(projectRoot(), ".grok");
  mkdirSync(outDir, { recursive: true });
  const profileDir = join(outDir, `smoke-profile-${user}`);
  const backupJson = join(outDir, `smoke-auth-${user}.json`);
  const profileA = join(outDir, "smoke-profile-a");
  const sessionA = user === "b" && existsSync(profileA) ? await readProfileSession(profileA) : null;

  if (fresh && existsSync(profileDir)) {
    rmSync(profileDir, { recursive: true, force: true });
    console.log(`[capture-smoke-auth] cleared profile ${profileDir}`);
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled"],
      baseURL,
    });
  } catch (error) {
    console.error(
      "[capture-smoke-auth] FAIL — install Google Chrome, or set PLAYWRIGHT_CHROME_CHANNEL=chrome",
    );
    throw error;
  }

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(MANUAL_HOME_TIMEOUT_MS);

  try {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    if (user === "b") {
      await signOutIfSameAsUserA(page, sessionA);
      if (sessionA?.email) {
        console.log(
          `[capture-smoke-auth] User A is ${sessionA.email} — User B must be a different Google smoke test account.`,
        );
      }
    }

    if (!isMeetHintHome(page.url())) {
      console.log(`>>> Sign in with the User ${user.toUpperCase()} Google account in the opened window.`);
      await startProductionGoogleSignIn(page);
    }

    await waitForManualHome(page);

    const captured = await verifySession(page, "capture");
    if (user === "b") {
      assertDistinctFromUserA(captured, sessionA);
    }

    await context.storageState({ path: backupJson });
    const { cookieCount, originCount } = sanitizeStorageStateFile(backupJson);

    if (cookieCount === 0) {
      console.error(
        "[capture-smoke-auth] FAIL — 0 cookies in backup JSON. Confirm OAuth test user and /home loaded.",
      );
      process.exit(1);
    }

    await context.close();
    context = null;

    const verifyContext = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled"],
      baseURL,
    });
    try {
      const verifyPage = verifyContext.pages()[0] ?? (await verifyContext.newPage());
      await verifyPage.goto("/home", { waitUntil: "domcontentloaded" });
      const verified = await verifySession(verifyPage, "post-capture verify");
      if (user === "b") {
        assertDistinctFromUserA(verified, sessionA);
      }
    } finally {
      await verifyContext.close();
    }

    console.log(`[capture-smoke-auth] profile ${profileDir}`);
    console.log(
      `[capture-smoke-auth] backup JSON ${backupJson} (${cookieCount} cookies, ${originCount} origins)`,
    );
    console.log(`[capture-smoke-auth] OK User ${user.toUpperCase()} — ${captured.email} (${captured.id})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const at = safeLocation(page.url());
    if (message.includes("Timed out after 10 minutes")) {
      console.error(`[capture-smoke-auth] FAIL — ${message}`);
    } else if (message.includes("different Google account")) {
      console.error(`[capture-smoke-auth] FAIL — ${message}`);
      console.error(`[capture-smoke-auth] Current location: ${at}`);
    } else {
      console.error(`[capture-smoke-auth] FAIL — ${message}`);
      console.error(`[capture-smoke-auth] Current location: ${at}`);
    }
    process.exit(1);
  } finally {
    await context?.close().catch(() => undefined);
  }
}

if (isMainModule(import.meta.url)) {
  await main();
}
