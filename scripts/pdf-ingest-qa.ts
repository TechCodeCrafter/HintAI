/**
 * Phase 4A.6 browser acceptance through /app.
 *
 * QA_URL=http://127.0.0.1:8080 node --experimental-strip-types scripts/pdf-ingest-qa.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { EVAL_PDF_FIXTURES } from "../src/lib/document/pdf/eval-fixtures.ts";

const origin = (process.env.QA_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const OUT = fileURLToPath(new URL("../.eval/phase4a/ingest/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const work = join(tmpdir(), `meethint-4a6-${Date.now()}`);
mkdirSync(work, { recursive: true });
const lecture = join(work, "lecture.pdf");
const scanned = join(work, "scanned.pdf");
const broken = join(work, "unreadable.pdf");
const refused = join(work, "refused.pdf");
writeFileSync(lecture, EVAL_PDF_FIXTURES["lecture.pdf"]);
writeFileSync(scanned, EVAL_PDF_FIXTURES["scanned.pdf"]);
writeFileSync(broken, EVAL_PDF_FIXTURES["unreadable.pdf"]);
writeFileSync(refused, EVAL_PDF_FIXTURES["refused.pdf"]);

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch(
  process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(30000);
const errors: string[] = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

async function waitReady() {
  await page.waitForFunction(
    () => {
      const root = document.querySelector("[data-context-status]");
      return (
        root?.getAttribute("data-context-status") === "ready" &&
        root.getAttribute("data-context-updating") !== "true"
      );
    },
    null,
    { timeout: 45000 },
  );
}

async function addPdfs(paths: string[]) {
  await page.locator("[data-add-material]").click();
  await page.locator("[data-add-pdf]").click();
  await page.locator("[data-pdf-input]").setInputFiles(paths);
  await page.waitForTimeout(400);
}

async function ask(question: string) {
  const box = page.locator("textarea.ground-question");
  await box.waitFor({ state: "visible" });
  await box.fill(question);
  await page.locator('[data-pane="room"] button[type="submit"]').click();
  await page.waitForTimeout(1600);
  const card = page.locator('[data-pane="card"]');
  const say = await card.locator("p.font-serif.text-fg").first().innerText().catch(() => "");
  const cite = await card.locator("button").filter({ hasText: /Page/ }).first().innerText().catch(() => "");
  return { say: say.trim(), cite: cite.replace(/\n/g, " ").trim() };
}

try {
  await page.goto(`${origin}/app`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator("[data-add-material]").waitFor({ state: "visible" });
  await page.screenshot({ path: join(OUT, "01-add-material.png") });

  await addPdfs([lecture]);
  await waitReady();
  const name = await page.locator('button[aria-haspopup="listbox"]').innerText();
  check("new Context named from the PDF", /lecture/i.test(name), name);
  const row = page.locator('[data-source-kind="pdf"][data-source-path="lecture.pdf"]');
  await row.waitFor({ state: "visible" });
  check("PDF appears in Repo as ready", (await row.getAttribute("data-source-status")) === "ready");
  await page.screenshot({ path: join(OUT, "02-ready.png") });

  await row.click();
  await page.waitForSelector('[data-pdf-pane="true"]');
  const browsePage = await page.locator("[data-pdf-page]").getAttribute("data-pdf-page");
  const browseMode = await page.locator("[data-highlight-mode]").getAttribute("data-highlight-mode");
  check("manual open is page 1", browsePage === "1", browsePage ?? "");
  check("manual open has no evidence highlight", browseMode === "caption-only" || browseMode === "Page only", browseMode ?? "");
  await page.screenshot({ path: join(OUT, "03-browse.png") });

  const card = await ask("What does serializable isolation prevent?");
  check("PDF question produces a Card", card.say.length > 8, card.say.slice(0, 90));
  check("citation names file and page", /lecture\.pdf · Page \d+/i.test(card.cite), card.cite);
  await page.screenshot({ path: join(OUT, "04-card.png") });

  await page.locator('[data-pane="card"] button').filter({ hasText: /Page/ }).first().click();
  await page.waitForSelector('[data-pdf-pane="true"]');
  const citeMode = await page.locator("[data-highlight-mode]").getAttribute("data-highlight-mode");
  check("citation opens the same PdfPane", Boolean(citeMode && citeMode !== "stale"), citeMode ?? "");
  await page.screenshot({ path: join(OUT, "05-citation.png") });

  const firstSay = card.say;
  const firstCite = card.cite;
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady();
  check("Context survives reload", /lecture/i.test(await page.locator('button[aria-haspopup="listbox"]').innerText()));
  check("PDF survives reload", await page.locator('[data-source-path="lecture.pdf"]').count() > 0);
  const again = await ask("What does serializable isolation prevent?");
  check("reload Card matches", again.say === firstSay, again.say.slice(0, 60));
  check("reload citation matches", again.cite === firstCite, again.cite);

  await addPdfs([scanned, broken, refused]);
  await waitReady();
  const scan = await page.locator('[data-source-path="scanned.pdf"]').getAttribute("data-source-status");
  const unread = await page.locator('[data-source-path="unreadable.pdf"]').getAttribute("data-source-status");
  const big = await page.locator('[data-source-path="refused.pdf"]').getAttribute("data-source-status");
  check("scanned is not called unreadable", scan === "scanned", scan ?? "");
  check("malformed is unreadable", unread === "unreadable", unread ?? "");
  check("over-limit is refused", big === "refused", big ?? "");
  await page.screenshot({ path: join(OUT, "06-terminal-states.png") });

  const landing = await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  const html = landing ? await page.content() : "";
  check("landing still says PDF Coming soon", /PDF[\s\S]*Coming soon/.test(html));
  const productErrors = errors.filter(
    (line) => !/favicon|Download the React DevTools|hydration-mismatch|style=\{\{\}\}/i.test(line),
  );
  check("clean console", productErrors.length === 0, productErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nFAIL  ${failed.length}/${results.length}` : `\nPASS  ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
