#!/usr/bin/env node
/**
 * Phase 2 persistence DoD: folder A survives reload, folder B cannot
 * retrieve A's material, and B stays active after a second reload.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_URL || "http://127.0.0.1:8080/app";
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const root = join(tmpdir(), `meethint-phase2-${Date.now()}`);
const folderA = join(root, "payments-backend");
const folderB = join(root, "cs401-notes");
mkdirSync(join(folderA, "src", "exporter"), { recursive: true });
mkdirSync(join(folderA, "src", "auth"), { recursive: true });
mkdirSync(join(folderB, "src", "notes"), { recursive: true });

writeFileSync(
  join(folderA, "src", "exporter", "retry.ts"),
  `/**
 * Retry policy for settlement exports.
 *
 * Attempts are capped at three because the payment gateway stalls rather than
 * failing fast, so a fourth attempt duplicates the settlement file instead of
 * recovering it.
 */
export const MAX_ATTEMPTS = 3;

export function backoffMs(attempt) {
  return 400 * 2 ** (Math.min(attempt, MAX_ATTEMPTS) - 1);
}
`,
);
writeFileSync(
  join(folderA, "src", "exporter", "index.ts"),
  `/** Settlement exporter for merchant payouts. */
export function exportSettlement() {
  return "csv";
}
`,
);
writeFileSync(
  join(folderA, "src", "auth", "session.ts"),
  `/** Verifies the session cookie on every non-public request. */
export function verifySession() {
  return true;
}
`,
);
writeFileSync(
  join(folderB, "src", "notes", "lecture.ts"),
  `/**
 * Lecture notes on lamportclocks ordering for CS401.
 */
export const topic = "clocks";

export function orderEvents() {
  return topic;
}
`,
);
writeFileSync(
  join(folderB, "src", "notes", "index.ts"),
  `/** Course notes for distributed systems. */
export function outline() {
  return "cs401";
}
`,
);

const QUESTION_A = "Why does that retry three times?";

const browser = await chromium.launch(
  process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));

async function waitReady() {
  await page.locator("textarea.ground-question").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Loading…"]'),
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(400);
}

async function ask(question) {
  const box = page.locator("textarea.ground-question");
  await box.waitFor({ state: "visible", timeout: 10000 });
  await box.fill(question);
  await page.locator('[data-pane="room"] button[type="submit"]').click({ timeout: 5000 });
  await page.waitForTimeout(1600);
  const cardPane = page.locator('[data-pane="card"]');
  const say = await cardPane
    .locator("p.font-serif.text-fg")
    .first()
    .innerText()
    .catch(() => "");
  const cite = await cardPane
    .locator("button:has(span.font-mono)")
    .first()
    .innerText()
    .catch(() => "");
  return { say: say.trim(), cite: cite.replace(/\n/g, " ").trim() };
}

async function openFolder(dir) {
  await page.locator('input[type="file"]').setInputFiles(dir);
  await waitReady();
}

try {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitReady();

  await openFolder(folderA);
  const nameA = await page.locator('button[aria-haspopup="listbox"]').innerText();
  check("loaded folder A", /payments-backend/i.test(nameA), nameA);

  const first = await ask(QUESTION_A);
  check("A answers from its own material", first.say.length > 8, first.say.slice(0, 90));
  check("A cites a file", /\.[a-z]+:\d+/i.test(first.cite), first.cite.slice(0, 70));

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady();
  const nameAReload = await page.locator('button[aria-haspopup="listbox"]').innerText();
  check("A still exists after reload", /payments-backend/i.test(nameAReload), nameAReload);

  const second = await ask(QUESTION_A);
  check("reload answer matches", second.say === first.say, `${second.say.slice(0, 60)} vs ${first.say.slice(0, 60)}`);
  check("reload citation matches", second.cite === first.cite, second.cite.slice(0, 70));

  await openFolder(folderB);
  const nameB = await page.locator('button[aria-haspopup="listbox"]').innerText();
  check("loaded folder B", /cs401-notes/i.test(nameB), nameB);

  const leaked = await ask(QUESTION_A);
  check("B stays silent on A's question", leaked.say.length === 0, leaked.say.slice(0, 90));

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady();
  const nameBReload = await page.locator('button[aria-haspopup="listbox"]').innerText();
  check("B remains active after reload", /cs401-notes/i.test(nameBReload), nameBReload);

  const leakedAgain = await Promise.race([
    ask(QUESTION_A),
    new Promise((resolve) => {
      setTimeout(() => resolve({ say: "", cite: "", timedOut: true }), 8000);
    }),
  ]);
  check("search still cannot retrieve A", leakedAgain.say.length === 0, leakedAgain.say.slice(0, 90));
  check("clean console", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nFAIL  ${failed.length}/${results.length}` : `\nPASS  ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
