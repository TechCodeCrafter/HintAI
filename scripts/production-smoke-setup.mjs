#!/usr/bin/env node
/**
 * Save Playwright storage state after manual Google sign-in on production.
 *
 * Saves OAuth session cookies only — provider API keys are stripped before write.
 * Inject keys at smoke runtime via MEETHINT_SMOKE_OPENAI_API_KEY.
 *
 * Usage:
 *   node scripts/production-smoke-setup.mjs --user a
 *   node scripts/production-smoke-setup.mjs --user b
 *
 * Do NOT add an LLM API key before pressing Enter. Sign in, reach /home, save.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";
import { chromium } from "playwright";

import {
  assertStorageStateSafe,
  sanitizeStorageStateFile,
  shouldStripLocalStorageKey,
} from "./production-smoke-sanitize.mjs";
import { isMainModule, projectRoot } from "./with-app-env.mjs";

const baseURL = (process.env.PLAYWRIGHT_BASE_URL ?? "https://www.meethint.ai").replace(/\/$/, "");

function parseUser(argv) {
  const idx = argv.indexOf("--user");
  const user = idx >= 0 ? argv[idx + 1]?.toLowerCase() : "a";
  if (user !== "a" && user !== "b") {
    console.error("Usage: node scripts/production-smoke-setup.mjs --user a|b");
    process.exit(1);
  }
  return user;
}

async function waitForEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve(undefined);
    });
  });
}

async function stripProviderSecretsInBrowser(page) {
  await page.evaluate((prefixes) => {
    const remove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (prefixes.some((p) => key === p || key.startsWith(`${p}.`))) remove.push(key);
    }
    for (const key of remove) localStorage.removeItem(key);
  }, ["meethint.providerKeys", "ground.pack", "meethint.flightLog"]);
}

async function main(argv) {
  const user = parseUser(argv);
  const outDir = join(projectRoot(), ".grok");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `smoke-auth-${user}.json`);

  console.log(`[production-smoke-setup] Opening ${baseURL}/login`);
  console.log(
    "[production-smoke-setup] Sign in with Google, reach /home, press Enter. Do not add an API key yet.",
  );

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/login");

  await waitForEnter("Press Enter after you are signed in and /home loads… ");

  await page.goto("/home");
  const loginVisible = await page.getByTestId("login-page").isVisible().catch(() => false);
  if (loginVisible) {
    console.error("[production-smoke-setup] FAIL — still on login page");
    await browser.close();
    process.exit(1);
  }

  await stripProviderSecretsInBrowser(page);
  await context.storageState({ path: outPath });
  const { cookieCount, originCount } = sanitizeStorageStateFile(outPath);
  await browser.close();

  console.log(
    `[production-smoke-setup] OK — saved OAuth state (${cookieCount} cookies, ${originCount} origins)`,
  );
  console.log(`[production-smoke-setup] Path: ${outPath}`);
  console.log(
    `[production-smoke-setup] Set MEETHINT_SMOKE_STORAGE_${user.toUpperCase()} to that path for smoke runs.`,
  );
}

if (isMainModule(import.meta.url)) {
  await main(process.argv.slice(2));
}

export { shouldStripLocalStorageKey, assertStorageStateSafe };
