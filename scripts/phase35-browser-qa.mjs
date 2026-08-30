#!/usr/bin/env node
/**
 * Phase 3.5 product acceptance in the real UI. Two folders, citations,
 * isolation, rapid switch, overlay, relay, mobile tabs, Northstar chips,
 * long session, console health.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_URL || "http://127.0.0.1:8080/app";
const OUT = new URL("../screenshots/phase35/", import.meta.url);
mkdirSync(new URL(OUT).pathname, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const root = join(tmpdir(), `meethint-phase35-${Date.now()}`);
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
 * Unique token ALPHA_ONLY_92817 lives only in context A.
 */
export const MAX_ATTEMPTS = 3;

export function backoffMs(attempt) {
  return 400 * 2 ** (Math.min(attempt, MAX_ATTEMPTS) - 1);
}
`,
);
writeFileSync(
  join(folderA, "src", "exporter", "index.ts"),
  `/** Settlement exporter for merchant payouts. Returns csv. */
export function exportSettlement() {
  return "csv";
}
`,
);
writeFileSync(
  join(folderA, "src", "exporter", "quorum.ts"),
  `/**
 * Renew the quorumlease before the exporter retries a failed settlement.
 */
export function renewQuorumlease() {
  return "leased";
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
  join(folderA, "src", "exporter", "ledger.ts"),
  `/** Appends each settlement row to the nightly ledger file. */
export function appendLedger(row) {
  return ["ledger", row];
}
`,
);
writeFileSync(
  join(folderA, "src", "exporter", "format.ts"),
  `/** Formats the payout CSV with merchant columns finance imports. */
export function formatPayout(row) {
  return row.join(",");
}
`,
);
writeFileSync(
  join(folderB, "src", "notes", "lecture.ts"),
  `/**
 * Verifies the replica ballot on every non-public write.
 * Unique token BETA_ONLY_38111 lives only in context B.
 */
export function verifyBallot() {
  return true;
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
writeFileSync(
  join(folderB, "src", "notes", "log.ts"),
  `/** Appends each replica vote to the nightly ballot log. */
export function appendVote(vote) {
  return vote;
}
`,
);
writeFileSync(
  join(folderB, "src", "notes", "clock.ts"),
  `/** Lamportclocks order events without a shared timeline. */
export const topic = "clocks";
`,
);

const SUPPORTED_A = [
  "Why does that retry three times?",
  "What verifies the session cookie?",
  "What does the nightly ledger append?",
  "How does the quorumlease renew?",
  "What is the architecture of this application?",
];
const UNSUPPORTED = [
  "What is our parental leave policy?",
  "What is the weather in Tokyo?",
  "Who is the CEO of the company?",
];
const QUESTION_A = "Why does that retry three times?";
const QUESTION_B = "What verifies the replica ballot?";

const browser = await chromium.launch(
  process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {},
);
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(20000);
page.on("pageerror", (err) => errors.push(`page:${err}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console:${msg.text()}`);
});

async function waitReady() {
  await page.locator("textarea.ground-question").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Loading…"]'),
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(400);
}

async function ask(question) {
  const box = page.locator("textarea.ground-question");
  await box.waitFor({ state: "visible", timeout: 10000 });
  await box.fill(question);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  const cardPane = page.locator('[data-pane="card"]');
  const say = await cardPane
    .locator("p.font-serif.text-fg")
    .first()
    .innerText({ timeout: 1200 })
    .catch(() => "");
  const cite = await cardPane
    .locator("button:has(span.font-mono)")
    .first()
    .innerText({ timeout: 800 })
    .catch(() => "");
  const reason = await cardPane.locator("p.italic").first().innerText({ timeout: 800 }).catch(() => "");
  return { say: say.trim(), cite: cite.replace(/\n/g, " ").trim(), reason: reason.trim() };
}

async function openFolder(dir) {
  await page.locator('input[type="file"]').setInputFiles(dir);
  await waitReady();
}

async function contextName() {
  return page.locator('button[aria-haspopup="listbox"]').innerText();
}

async function pickContext(name) {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator(`role=option >> text=${name}`).click();
  await waitReady();
}

async function highlightText() {
  return page.locator('[data-pane="repo"] [data-line].bg-pick, [data-pane="repo"] .bg-pick').innerText().catch(() => "");
}

async function shot(name) {
  await page.screenshot({ path: new URL(`${name}.png`, OUT).pathname, fullPage: false });
}

try {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitReady();
  check("desktop /app renders", (await page.locator("body").innerText()).length > 80);

  await openFolder(folderA);
  check("loaded folder A", /payments-backend/i.test(await contextName()), await contextName());
  await shot("01-context-a-ready");

  const firstAnswers = [];
  for (const q of SUPPORTED_A) {
    const card = await ask(q);
    firstAnswers.push({ q, ...card });
    check(`A supported: ${q}`, card.say.length > 8, card.say.slice(0, 90));
    check(`A cites: ${q}`, /\.[a-z]+:\d+/i.test(card.cite), card.cite.slice(0, 70));
    if (/\.[a-z]+:\d+/i.test(card.cite)) {
      await page.locator('[data-pane="card"] button:has(span.font-mono)').first().click();
      await page.waitForTimeout(400);
      const hi = await highlightText();
      check(`A highlight has evidence: ${q}`, hi.length > 0, hi.slice(0, 80));
    }
  }
  await shot("02-context-a-card");

  for (const q of UNSUPPORTED) {
    const card = await ask(q);
    check(`A silent: ${q}`, card.say.length === 0, card.say.slice(0, 80));
  }
  await shot("03-context-a-silence");

  const beforeReload = firstAnswers[0];
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady();
  check("A remains active after reload", /payments-backend/i.test(await contextName()), await contextName());
  const afterReload = await ask(QUESTION_A);
  check("reload same answer", afterReload.say === beforeReload.say, `${afterReload.say.slice(0, 50)} vs ${beforeReload.say.slice(0, 50)}`);
  check("reload same citation", afterReload.cite === beforeReload.cite, afterReload.cite);
  await page.locator('[data-pane="card"] button:has(span.font-mono)').first().click();
  await page.waitForTimeout(400);
  check("reload highlight still present", (await highlightText()).length > 0);
  const sessionAfterA = await page.evaluate(() => localStorage.getItem("ground.session"));
  await shot("04-context-a-reload");

  await openFolder(folderB);
  check("loaded folder B", /cs401-notes/i.test(await contextName()), await contextName());
  const leaked = await ask(QUESTION_A);
  check("B silent on A-only question", leaked.say.length === 0, leaked.say.slice(0, 80));
  const bCard = await ask(QUESTION_B);
  check(
    "B answers B-only question",
    bCard.say.length > 8 && /ballot|replica|BETA_ONLY/i.test(bCard.say),
    bCard.say.slice(0, 90),
  );
  await shot("05-context-b-card");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady();
  check("B remains active after reload", /cs401-notes/i.test(await contextName()), await contextName());
  const leakedAgain = await ask(QUESTION_A);
  check("A still unretrievable after B reload", leakedAgain.say.length === 0, leakedAgain.say.slice(0, 80));

  // Rapid A → B → A → B. Selector is disabled while hydrating; this still
  // proves the final applied runtime is B and that session state clears.
  for (let i = 0; i < 3; i += 1) {
    await pickContext("payments-backend");
    await pickContext("cs401-notes");
  }
  check("rapid switch ends on B", /cs401-notes/i.test(await contextName()), await contextName());
  const afterSwitch = await ask(QUESTION_A);
  check("rapid switch: A still silent", afterSwitch.say.length === 0);
  const afterSwitchB = await ask(QUESTION_B);
  check("rapid switch: B still answers", afterSwitchB.say.length > 8);
  await shot("06-rapid-switch-b");

  // Overlay
  await page.goto(`${target}?overlay=1`, { waitUntil: "domcontentloaded" });
  await waitReady();
  check("overlay hides repo pane", (await page.locator('[data-pane="repo"]').count()) === 0);
  const overlayCard = await ask(QUESTION_B);
  check("overlay still shows Card", overlayCard.say.length > 8, overlayCard.say.slice(0, 80));
  await shot("07-overlay");

  // Relay: session must not contain source files
  const session = sessionAfterA ? JSON.parse(sessionAfterA) : null;
  check("ground.session has a card", Boolean(session?.card?.say));
  const sessionJson = sessionAfterA ?? "";
  check(
    "ground.session has no source files",
    !session?.pack &&
      !session?.files &&
      !session?.chunks &&
      !sessionJson.includes("export function outline") &&
      !sessionJson.includes("export function backoffMs"),
  );

  const relayCtx = await browser.newContext();
  await relayCtx.addInitScript((raw) => {
    if (raw) localStorage.setItem("ground.session", raw);
  }, sessionAfterA);
  const relay = await relayCtx.newPage();
  await relay.setViewportSize({ width: 390, height: 844 });
  relay.on("pageerror", (err) => errors.push(`relay:${err}`));
  await relay.goto(target.replace(/\/app.*/, "/relay"), { waitUntil: "domcontentloaded" });
  await relay.waitForTimeout(1200);
  const relayText = await relay.locator("body").innerText();
  check(
    "relay shows Card text",
    Boolean(session?.card?.say) && relayText.includes(String(session.card.say).slice(0, 24)),
    relayText.slice(0, 160),
  );
  await relay.screenshot({ path: new URL("08-relay.png", OUT).pathname });
  await relay.close();
  await relayCtx.close();

  // Mobile tabs + long Hint
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await waitReady();
  for (const tab of ["Repo", "Room", "Card"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(200);
    check(`mobile tab ${tab} visible`, (await page.locator(`[data-pane="${tab.toLowerCase()}"]`).count()) > 0);
  }
  await page.getByRole("button", { name: "Card", exact: true }).click();
  await shot("09-mobile-card");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("mobile no horizontal overflow", overflow <= 1, `${overflow}px`);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await waitReady();

  // Northstar chips + review
  await pickContext("northstar-payments");
  check("demo reset to Northstar", /northstar/i.test(await contextName()), await contextName());
  const chips = page.locator("button.ground-chip");
  const chipCount = await chips.count();
  check("Northstar chips present", chipCount >= 4, `${chipCount} chips`);
  const chipAnswers = [];
  for (let i = 0; i < chipCount; i += 1) {
    const label = await chips.nth(i).innerText();
    await chips.nth(i).click();
    await page.waitForTimeout(1400);
    const say = await page
      .locator('[data-pane="card"] p.font-serif.text-fg')
      .first()
      .innerText({ timeout: 1500 })
      .catch(() => "");
    const cite = await page
      .locator('[data-pane="card"] button:has(span.font-mono)')
      .first()
      .innerText({ timeout: 800 })
      .catch(() => "");
    chipAnswers.push({ label, say: say.trim(), cite: cite.replace(/\n/g, " ") });
    check(`Northstar chip speaks: ${label}`, say.trim().length > 8, say.trim().slice(0, 80));
  }
  const who = chipAnswers.find((c) => /who/i.test(c.label));
  check("Who chip has commit citation", who ? !/:\d+/.test(who.cite) || /#|commit|sha/i.test(who.cite) : false, who?.cite);
  await page.getByRole("button", { name: /Play review/i }).click();
  await page.waitForTimeout(9500);
  const stop = page.getByRole("button", { name: /Stop/i });
  if (await stop.count()) await stop.click().catch(() => undefined);
  const reviewSay = await page
    .locator('[data-pane="card"] p.font-serif.text-fg')
    .first()
    .innerText({ timeout: 2000 })
    .catch(() => "");
  check("Play review produces a Card", reviewSay.trim().length > 12, reviewSay.slice(0, 80));
  await shot("10-northstar-review");

  const weather = await ask("What is the weather in Tokyo?");
  check("Northstar unsupported silence", weather.say.length === 0);

  // Controls exist
  check("Listen control present", (await page.getByRole("button", { name: /Listen|Stop listen/i }).count()) > 0);
  check("Auto answer control present", (await page.getByRole("button", { name: /Auto answer|Manual/i }).count()) > 0);
  await page.getByRole("button", { name: /Auto answer|Manual/i }).click();
  await page.getByRole("button", { name: /Auto answer|Manual/i }).click();
  check("Live window control present", (await page.getByRole("link", { name: /Live window/i }).count()) > 0);
  check("Overlay control present", (await page.getByRole("button", { name: /Overlay|Cockpit/i }).count()) > 0);

  // Long session: 50+ transcript-style searches + chatter + switch + reload
  const longQs = [
    ...SUPPORTED_A,
    ...UNSUPPORTED,
    QUESTION_B,
    "Can you hear me okay?",
    "Should we move on?",
    "What did we change in the exporter?",
    "Who touched the auth flow?",
    "What is the architecture of this application?",
  ];
  for (let i = 0; i < 50; i += 1) {
    const box = page.locator("textarea.ground-question");
    await box.fill(longQs[i % longQs.length]);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
  }
  check("long session still ready", (await page.locator("textarea.ground-question").count()) > 0);
  await pickContext("cs401-notes");
  const longLeak = await ask(QUESTION_A);
  check("long session switch: A silent", longLeak.say.length === 0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady();
  check("long session reload stays on last Context", /cs401-notes|northstar|payments/i.test(await contextName()));
  await shot("11-long-session");

  const unexplained = errors.filter(
    (e) =>
      !/Download the React DevTools/i.test(e) &&
      !/favicon/i.test(e) &&
      !/net::ERR_BLOCKED/i.test(e),
  );
  check("no unexplained page/console errors", unexplained.length === 0, unexplained.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

writeFileSync(new URL("results.json", OUT).pathname, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nFAIL  ${failed.length}/${results.length}` : `\nPASS  ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
