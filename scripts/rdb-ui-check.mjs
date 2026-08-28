/**
 * Drives the real UI with the real rdb-labsai-backend pack loaded and asks the
 * demo questions through the Search box, screenshotting each Card.
 *
 * node --experimental-strip-types scripts/rdb-dryrun.ts   # writes the pack
 * node scripts/rdb-ui-check.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const SHOTS = "screenshots/";
mkdirSync(SHOTS, { recursive: true });
const pack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));

const QUESTIONS = [
  "How does this application work end to end?",
  "How is the Excel export generated?",
  "How does session management work?",
  "What is our parental leave policy?",
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript((wire) => localStorage.setItem("ground.pack", wire), JSON.stringify(pack));
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);

const card = page.locator('[data-pane="card"]');
const sayEl = card.locator("p.font-serif.text-fg").first();
const repo = page.locator('[data-pane="repo"]');

console.log(`LOADED  ${(await repo.innerText()).split("\n").slice(0, 2).join(" | ")}`);

let i = 0;
for (const question of QUESTIONS) {
  i += 1;
  const box = page.locator("textarea.ground-question");
  await box.fill(question);
  await box.press("Enter");
  await page.waitForTimeout(2200);
  const say = (await sayEl.count()) ? (await sayEl.innerText()).trim() : "";
  const chips = await card.locator("button:has(span.font-mono)").allInnerTexts();
  console.log(`\nQ  ${question}`);
  console.log(`   SAY   ${say || "(silent)"}`);
  for (const chip of chips) console.log(`   CITE  ${chip.replace(/\n/g, " ")}`);
  await card.screenshot({ path: `${SHOTS}rdb-card-${i}.png` });
}

console.log(`\nconsole errors: ${errors.length ? errors.join("\n") : "none"}`);
await page.screenshot({ path: `${SHOTS}rdb-full.png` });
await browser.close();
