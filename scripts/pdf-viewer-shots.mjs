#!/usr/bin/env node
/**
 * Capture Phase 4A.5 PDF viewer states.
 *
 * QA_URL=http://127.0.0.1:8080 node scripts/pdf-viewer-shots.mjs
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const origin = (process.env.QA_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const OUT = fileURLToPath(new URL("../.eval/phase4a/viewer/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const shots = [
  { id: "exact", file: "01-exact.png", width: 1280, height: 800 },
  { id: "multi", file: "02-multi.png", width: 1280, height: 800 },
  { id: "hyphen", file: "03-hyphen.png", width: 1280, height: 800 },
  { id: "twocol-left", file: "04-twocol-left.png", width: 1280, height: 800 },
  { id: "twocol-right", file: "05-twocol-right.png", width: 1280, height: 800 },
  { id: "item-box", file: "06-item-box.png", width: 1280, height: 800 },
  { id: "caption", file: "07-caption.png", width: 1280, height: 800 },
  { id: "mobile", file: "08-mobile.png", width: 390, height: 844, cockpit: true },
  { id: "stale", file: "09-stale.png", width: 1280, height: 800 },
];

const browser = await chromium.launch(
  process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {},
);

const browserMetrics = [];
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
  const t0 = Date.now();
  if (shot.cockpit) {
    await page.goto(`${origin}/app?viewerqa=1`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByRole("button", { name: /lecture\.pdf · Page/ }).click();
    await page.waitForSelector('[data-pdf-pane="true"]', { timeout: 30000 });
  } else {
    await page.goto(`${origin}/eval/viewer?shot=${shot.id}`, { waitUntil: "networkidle", timeout: 60000 });
  }
  await page.waitForSelector('[data-highlight-mode], [data-pdf-state="stale"]', { timeout: 30000 });
  await page.waitForTimeout(600);
  const metric = await page.evaluate(() => window.__lastViewerMetric ?? null);
  const mode = await page.getAttribute("[data-highlight-mode]", "data-highlight-mode");
  await page.screenshot({ path: `${OUT}${shot.file}`, fullPage: true });
  browserMetrics.push({ id: shot.id, mode, wallMs: Date.now() - t0, metric });
  console.log(`wrote ${shot.file} mode=${mode ?? "stale"}`);
  await page.close();
}

await browser.close();
const { writeFileSync } = await import("node:fs");
writeFileSync(`${OUT}browser-latency.json`, `${JSON.stringify(browserMetrics, null, 2)}\n`);
