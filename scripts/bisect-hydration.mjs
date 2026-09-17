#!/usr/bin/env node
/**
 * Bisect React #418 hydration errors across clean Chromium vs Brave profiles.
 *
 * Usage:
 *   node scripts/bisect-hydration.mjs
 *   MEETHINT_BISECT_BASE=http://127.0.0.1:8081 node scripts/bisect-hydration.mjs
 *   node scripts/bisect-hydration.mjs --base https://www.meethint.ai
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./with-app-env.mjs";

const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const DEFAULT_BASE = "https://www.meethint.ai";
const LOG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hydration-bisect.log");

function parseBase(argv) {
  const idx = argv.indexOf("--base");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1].replace(/\/+$/, "");
  return (process.env.MEETHINT_BISECT_BASE ?? DEFAULT_BASE).replace(/\/+$/, "");
}

function urlsForBase(base) {
  return [`${base}/`, `${base}/home`, `${base}/login`];
}

const targets = [
  ["clean-chromium", {}],
  ["brave-no-ext-no-shields", { executablePath: BRAVE, args: ["--disable-extensions", "--disable-features=BraveShields"] }],
  ["brave-normal", { executablePath: BRAVE }],
];

export async function runHydrationBisect({ baseUrl, logPath = LOG_PATH, launch = chromium.launch.bind(chromium) } = {}) {
  const urls = urlsForBase(baseUrl ?? DEFAULT_BASE);
  fs.writeFileSync(logPath, `base=${urls[0].replace(/\/[^/]*$/, "")}\n`);

  for (const [name, opts] of targets) {
    let browser;
    try {
      browser = await launch(opts);
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      console.log(name.padEnd(26), "LAUNCH FAILED:", message);
      continue;
    }

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") {
        fs.appendFileSync(logPath, `\n[${name}] ${message.text()}\n`);
      }
    });
    page.on("pageerror", (error) => {
      fs.appendFileSync(logPath, `\n[${name}] PAGEERROR ${error.message}\n`);
    });

    for (const url of urls) {
      await page.goto(url, { waitUntil: "load", timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }

    await browser.close();
    console.log(name.padEnd(26), "done");
  }

  const log = fs.readFileSync(logPath, "utf8");
  const has418 = /#418|hydration/i.test(log);
  return { logPath, has418, log };
}

async function main(argv) {
  const baseUrl = parseBase(argv);
  const { logPath, has418 } = await runHydrationBisect({ baseUrl });
  console.log(`\nFull console errors saved to ${logPath}`);
  if (has418) {
    console.error("[bisect-hydration] Detected hydration-related console errors — see log");
    process.exit(1);
  }
  console.log("[bisect-hydration] No hydration console errors detected");
}

if (isMainModule(import.meta.url)) {
  await main(process.argv.slice(2));
}
