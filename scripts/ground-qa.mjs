#!/usr/bin/env node
/**
 * Browser QA for the GROUND product loop. Verifies render health on both
 * viewports, then drives the manual Search fallback end to end and asserts the
 * Card cites something. Audio lanes cannot be faked here; the gate and Card
 * rules are covered by src/lib/search/*.test.ts.
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const target = process.env.QA_URL || "http://127.0.0.1:8080/app";
const OUT = fileURLToPath(new URL("../screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const FILLER = /^(based on|according to|it appears|the (documentation|repo|repository|code) (suggests|shows))/i;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// Playwright's bundled resolver can pick the wrong host arch; QA_BROWSER wins.
const browser = await chromium.launch(
  process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {},
);

for (const view of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const page = await browser.newPage({ viewport: { width: view.width, height: view.height } });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto(target, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);

  const text = (await page.locator("body").innerText()).trim();
  check(`${view.name}: renders visible content`, text.length > 80, `${text.length} chars`);
  check(`${view.name}: clean console`, errors.length === 0, errors.slice(0, 2).join(" | "));

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`${view.name}: no horizontal overflow`, overflow <= 1, `${overflow}px`);

  if (view.name === "desktop") {
    // Manual Search is the fallback the product promises when audio fails.
    await page.locator("textarea.ground-question").fill("Why does that retry three times?");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);

    const cardPane = page.locator('[data-pane="card"]');
    const say = await cardPane
      .locator("p.font-serif.text-fg")
      .first()
      .innerText()
      .catch(() => "");
    check("manual Search produces a spoken line", say.trim().length > 12, say.slice(0, 90));
    check("spoken line has no filler opening", !FILLER.test(say.trim()), say.slice(0, 60));

    const cite = await cardPane
      .locator("button:has(span.font-mono)")
      .first()
      .innerText()
      .catch(() => "");
    check("Card cites a file and line", /\.[a-z]+:\d+/i.test(cite), cite.replace(/\n/g, " ").slice(0, 70));

    // An off-topic question must leave the Card empty.
    await page.locator("textarea.ground-question").fill("What is our parental leave policy?");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    // The say paragraph is the only p.font-serif.text-fg in the pane, so its
    // absence is the honest signal that GROUND chose silence.
    const sayCount = await cardPane.locator("p.font-serif.text-fg").count();
    const reason = await cardPane
      .locator("p.italic")
      .first()
      .innerText()
      .catch(() => "");
    check("off-topic question yields no spoken line", sayCount === 0, reason.slice(0, 70));

    check(
      "own-speech line hidden when nothing was heard from the mic",
      !(await page.locator("text=You · ").count()),
    );

    // Scripted review: "them" beats must still reach a Card, "you" beats must
    // render as the mic lane rather than being mistaken for the room.
    await page.getByRole("button", { name: /Play review/i }).click();
    await page.waitForTimeout(9000);
    const played = await cardPane
      .locator("p.font-serif.text-fg")
      .first()
      .innerText()
      .catch(() => "");
    check("scripted review still produces a Card", played.trim().length > 12, played.slice(0, 80));
    check("scripted review labels your own speech", (await page.locator("text=You · ").count()) > 0);
  }

  await page.screenshot({ path: `${OUT}ground-${view.name}.png`, fullPage: false });
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
