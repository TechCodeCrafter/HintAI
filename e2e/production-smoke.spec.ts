import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { injectSmokeOpenAiKey } from "./fixtures/production-smoke-keys";
import {
  defaultSmokeProfile,
  launchSmokeProfile,
  smokeProfileReady,
} from "./fixtures/production-smoke-profile";
import {
  SMOKE_FILE,
  SMOKE_MARKER,
  SMOKE_SUPPORTED_QUESTION,
  SMOKE_UNSUPPORTED_QUESTION,
  assertDiagnosticsPrivacy,
  collectSmokeDiagnostics,
  emptyTimings,
  fillCreateContextIdentity,
  markSmokeStepOutcomes,
  percentile,
  smokeSourceBuffer,
  smokeSpaceName,
  waitForAskReady,
  waitForAuthenticatedHome,
  waitForIndexing,
  type SmokeTimings,
} from "./fixtures/production-smoke-shared";

const smokeOpenAiKey = process.env.MEETHINT_SMOKE_OPENAI_API_KEY?.trim();
const smokeRunId = process.env.MEETHINT_SMOKE_RUN_ID?.trim() ?? null;

const reportPath =
  process.env.MEETHINT_SMOKE_REPORT ?? path.join(process.cwd(), ".grok/production-smoke-report.json");

const LIVE_QUESTIONS = [
  "What export names the smoke gate token constant?",
  "Which file contains the smoke gate marker comment?",
  "What is the purpose comment on the smoke gate file?",
  "Does the smoke source mention beta production smoke?",
  "What string literal is assigned to token?",
  "Is the smoke gate token exported from smoke-gate.ts?",
  "What marker value appears in the smoke gate source?",
  "What is the Zylorp Corporation billing code in the smoke source?",
];

test.describe.configure({ mode: "serial" });

test.skip(
  !smokeProfileReady("a"),
  `Missing Chrome profile — run: node scripts/capture-smoke-auth.mjs a (expected ${defaultSmokeProfile("a")})`,
);
test.skip(
  !smokeProfileReady("b"),
  `Missing Chrome profile B — run: node scripts/capture-smoke-auth.mjs b with a different Google smoke account`,
);
test.skip(!smokeOpenAiKey, "Set MEETHINT_SMOKE_OPENAI_API_KEY — dedicated smoke key, not saved in auth JSON");

test("fresh account production smoke — full gate", async () => {
  const timings = emptyTimings();
  const steps: Record<string, "PASS" | "FAIL" | "SKIP"> = {};
  let spaceId = "";
  let diagnosticsJson = "";
  let userAEmail = "";
  let userAId = "";

  const contextA = await launchSmokeProfile("a");
  const page = contextA.pages()[0] ?? (await contextA.newPage());
  const loginStart = Date.now();

  try {
    await page.goto("/home");
    await waitForAuthenticatedHome(page);
    ({ email: userAEmail, id: userAId } = await readSmokeSession(page));
    expect(userAEmail).toBeTruthy();
    expect(userAId).toBeTruthy();
    timings.loginMs = Date.now() - loginStart;
    steps["auth-session"] = "PASS";

    await injectSmokeOpenAiKey(page, smokeOpenAiKey!);
    steps["api-key-injected"] = "PASS";

    const smokeSpace = smokeSpaceName();
    await page.goto("/create");
    await fillCreateContextIdentity(page, smokeSpace);
    const indexStart = Date.now();
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("upload-files-button").click(),
    ]);
    await fileChooser.setFiles([
      { name: SMOKE_FILE, mimeType: "text/plain", buffer: smokeSourceBuffer() },
    ]);
    await waitForIndexing(page);
    timings.indexReadyMs = Date.now() - indexStart;
    await page.getByTestId("indexing-done").click();
    await expect(page).toHaveURL(/\/context\/[^/?#]+/, { timeout: 30_000 });
    spaceId = page.url().match(/\/context\/([^/?#]+)/)?.[1] ?? "";
    expect(spaceId).toBeTruthy();
    steps["index-ready"] = "PASS";
    steps["space-created"] = "PASS";

    await page.goto(`/context/${spaceId}/ask`);
    await injectSmokeOpenAiKey(page, smokeOpenAiKey!);
    await waitForAskReady(page);
    const chunkCount = await page.evaluate(() => {
      const store = (window as Window & { useMeetHint?: { getState: () => { chunks: unknown[] } } }).useMeetHint;
      return store?.getState().chunks.length ?? 0;
    });
    expect(chunkCount).toBeGreaterThan(0);
    const supportedStart = Date.now();
    await page.getByTestId("ask-query").fill(SMOKE_SUPPORTED_QUESTION);
    await page.getByTestId("ask-submit").click();
    const askCard = page.getByTestId("ask-card");
    await expect(askCard).toBeVisible({ timeout: 120_000 });
    await expect(askCard.getByTestId("card-say")).toContainText(SMOKE_MARKER, { timeout: 120_000 });
    const cite = askCard.getByTestId("card-citation").first();
    await expect(cite).toBeVisible();
    await cite.locator("button").click();
    await expect(page.getByText(SMOKE_FILE).first()).toBeVisible({ timeout: 15_000 });
    timings.firstUsefulAnswerMs = Date.now() - supportedStart;
    timings.supportedAnswerCount += 1;
    steps["supported-ask"] = "PASS";
    steps["citation-open"] = "PASS";

    await askCard.getByTestId("answer-feedback-useful").click();
    steps["feedback-useful"] = "PASS";

    await page.getByTestId("ask-query").fill(SMOKE_UNSUPPORTED_QUESTION);
    await page.getByTestId("ask-submit").click();
    await expect(askCard).toBeVisible({ timeout: 120_000 });
    await expect(askCard).toContainText(SMOKE_UNSUPPORTED_QUESTION, { timeout: 120_000 });
    await expect(page.getByTestId("ask-submit")).not.toHaveText("Searching…", { timeout: 120_000 });
    const unsupportedSay = askCard.getByTestId("card-say");
    const hasSay = await unsupportedSay.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasSay) {
      const text = (await unsupportedSay.textContent()) ?? "";
      expect(text).not.toMatch(/zylorp|123 main|headquarters/i);
      timings.unsupportedConfidentCount += 1;
      steps["unsupported-ask"] = "FAIL";
    } else {
      steps["unsupported-ask"] = "PASS";
    }

    await page.goto(`/context/${spaceId}/live`);
    await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", {
      timeout: 60_000,
    });
    steps["live-start"] = "PASS";

    for (const question of LIVE_QUESTIONS) {
      const t0 = Date.now();
      await page.getByTestId("search-input").fill(question);
      await page.getByTestId("search-input").press("Enter");
      const card = page.getByTestId("card");
      await card.waitFor({ timeout: 90_000 });
      const latency = Date.now() - t0;
      timings.liveLatenciesMs.push(latency);
      const say = card.getByTestId("card-say");
      if (await say.isVisible({ timeout: 5_000 }).catch(() => false)) {
        const body = ((await say.textContent({ timeout: 5_000 }).catch(() => "")) ?? "");
        if (question.includes("Zylorp")) {
          expect(body).not.toMatch(/zylorp/i);
        } else if (body.includes(SMOKE_MARKER)) {
          timings.supportedAnswerCount += 1;
        }
      }
    }
    steps["live-questions"] = "PASS";

    await page.getByTestId("search-input").fill("What marker appears in the smoke gate comment?");
    await page.getByTestId("search-input").press("Enter");
    const liveCard = page.getByTestId("card");
    await liveCard.waitFor({ timeout: 90_000 });
    await expect(liveCard.getByTestId("card-say")).toBeVisible({ timeout: 90_000 });
    await expect(liveCard.getByTestId("answer-feedback-toggle")).toBeEnabled({ timeout: 30_000 });
    await liveCard.getByTestId("answer-feedback-toggle").click();
    await liveCard.getByTestId("answer-feedback-wrong-source").click();
    steps["feedback-not-useful"] = "PASS";

    diagnosticsJson = await collectSmokeDiagnostics(page);
    assertDiagnosticsPrivacy(diagnosticsJson);
    steps["diagnostics-privacy"] = "PASS";

    await page.reload();
    await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", {
      timeout: 60_000,
    });
    steps["refresh-session"] = "PASS";

    await contextA.close();

    const contextA2 = await launchSmokeProfile("a");
    const page2 = contextA2.pages()[0] ?? (await contextA2.newPage());
    await page2.goto("/home");
    await waitForAuthenticatedHome(page2);
    await injectSmokeOpenAiKey(page2, smokeOpenAiKey!);
    await page2.goto(`/context/${spaceId}/ask`);
    await waitForAskReady(page2);
    await page2.getByTestId("ask-query").fill(SMOKE_SUPPORTED_QUESTION);
    await page2.getByTestId("ask-submit").click();
    await expect(page2.getByTestId("ask-card")).toContainText(SMOKE_MARKER, { timeout: 120_000 });
    steps["same-user-persistence"] = "PASS";
    await contextA2.close();

    const contextB = await launchSmokeProfile("b");
    const pageB = contextB.pages()[0] ?? (await contextB.newPage());
    await pageB.goto("/home");
    await waitForAuthenticatedHome(pageB);
    const { email: userBEmail, id: userBId } = await readSmokeSession(pageB);
    expect(userBEmail).toBeTruthy();
    expect(userBId).toBeTruthy();
    expect(userBEmail).not.toBe(userAEmail);
    expect(userBId).not.toBe(userAId);

    await expect(pageB.locator("body")).not.toContainText(smokeSpace);
    await expect(pageB.locator("body")).not.toContainText(SMOKE_MARKER);
    await expect(pageB.locator("body")).not.toContainText(SMOKE_FILE);
    if ((await pageB.getByTestId("space-list").count()) > 0) {
      await expect(pageB.getByTestId("space-list")).not.toContainText(smokeSpace);
    }

    await pageB.goto(`/context/${spaceId}`);
    await expect(pageB.getByTestId("space-missing")).toBeVisible();
    await expect(pageB.locator("body")).not.toContainText(SMOKE_MARKER);
    await expect(pageB.locator("body")).not.toContainText(SMOKE_FILE);

    await pageB.goto(`/context/${spaceId}/ask`);
    await expect(pageB.locator("body")).not.toContainText(SMOKE_MARKER);
    await expect(pageB.getByTestId("ask-card")).toHaveCount(0);
    await expect(pageB.getByTestId("card-citation")).toHaveCount(0);

    await injectSmokeOpenAiKey(pageB, smokeOpenAiKey!);
    if (await pageB.getByTestId("ask-query").isEnabled().catch(() => false)) {
      await pageB.getByTestId("ask-query").fill(SMOKE_SUPPORTED_QUESTION);
      await pageB.getByTestId("ask-submit").click();
      await expect(pageB.locator("body")).not.toContainText(SMOKE_MARKER, { timeout: 120_000 });
      await expect(pageB.getByTestId("card-citation")).toHaveCount(0);
    }

    await pageB.goto(`/context/${spaceId}/live`);
    await expect(pageB.locator("body")).not.toContainText(SMOKE_MARKER);
    await expect(pageB.getByTestId("answer-history")).toHaveCount(0);
    if (await pageB.getByTestId("search-input").isVisible().catch(() => false)) {
      await pageB.getByTestId("search-input").fill(SMOKE_SUPPORTED_QUESTION);
      await pageB.getByTestId("search-input").press("Enter");
      await expect(pageB.locator("body")).not.toContainText(SMOKE_MARKER, { timeout: 90_000 });
      await expect(pageB.getByTestId("card-citation")).toHaveCount(0);
    }

    const leaked = await pageB.evaluate(
      ({ marker, spaceName, fileName }) => {
        const state = (
          window as Window & {
            useMeetHint?: {
              getState: () => {
                pack?: { files?: Array<{ content: string; path?: string }> };
                answerHistory?: Array<{ query: string; say?: string }>;
                card?: { say?: string };
                contexts?: Array<{ name: string }>;
                chunks?: Array<{ text?: string }>;
                sources?: Array<{ name?: string }>;
              };
            };
          }
        ).useMeetHint?.getState?.();
        if (!state) {
          return { pack: false, history: false, card: false, contexts: false, chunks: false, sources: false };
        }
        const pack =
          state.pack?.files?.some(
            (file) => file.content.includes(marker) || file.path?.includes(fileName),
          ) ?? false;
        const history =
          state.answerHistory?.some(
            (item) => item.query.includes(marker) || (item.say ?? "").includes(marker),
          ) ?? false;
        const card = (state.card?.say ?? "").includes(marker);
        const contexts = state.contexts?.some((row) => row.name.includes(spaceName)) ?? false;
        const chunks = state.chunks?.some((chunk) => (chunk.text ?? "").includes(marker)) ?? false;
        const sources = state.sources?.some((source) => (source.name ?? "").includes(fileName)) ?? false;
        return { pack, history, card, contexts, chunks, sources };
      },
      { marker: SMOKE_MARKER, spaceName: smokeSpace, fileName: SMOKE_FILE },
    );
    expect(leaked.pack).toBe(false);
    expect(leaked.history).toBe(false);
    expect(leaked.card).toBe(false);
    expect(leaked.contexts).toBe(false);
    expect(leaked.chunks).toBe(false);
    expect(leaked.sources).toBe(false);
    await contextB.close();

    const contextA3 = await launchSmokeProfile("a");
    const pageA3 = contextA3.pages()[0] ?? (await contextA3.newPage());
    await pageA3.goto("/home");
    await waitForAuthenticatedHome(pageA3);
    const restoredA = await readSmokeSession(pageA3);
    expect(restoredA.email).toBe(userAEmail);
    expect(restoredA.id).toBe(userAId);
    await injectSmokeOpenAiKey(pageA3, smokeOpenAiKey!);
    await pageA3.goto(`/context/${spaceId}/ask`);
    await waitForAskReady(pageA3);
    await pageA3.getByTestId("ask-query").fill(SMOKE_SUPPORTED_QUESTION);
    await pageA3.getByTestId("ask-submit").click();
    await expect(pageA3.getByTestId("ask-card")).toContainText(SMOKE_MARKER, { timeout: 120_000 });
    await contextA3.close();

    steps["cross-user-isolation"] = "PASS";
  } catch (error) {
    await contextA.close().catch(() => undefined);
    markSmokeStepOutcomes(steps);
    writeReport({ steps, timings, error: String(error), spaceId, diagnosticsJson });
    throw error;
  }

  writeReport({ steps, timings, spaceId, diagnosticsJson });
  const failedSteps = Object.entries(steps).filter(([, v]) => v === "FAIL");
  if (failedSteps.length > 0) {
    throw new Error(`Smoke steps failed: ${failedSteps.map(([k]) => k).join(", ")}`);
  }
});

async function readSmokeSession(page: import("@playwright/test").Page): Promise<{ email: string; id: string }> {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session", { credentials: "include" });
    const session = await response.json();
    return { email: session?.user?.email ?? "", id: session?.user?.id ?? "" };
  });
}

function writeReport(payload: {
  steps: Record<string, string>;
  timings: SmokeTimings;
  spaceId?: string;
  diagnosticsJson?: string;
  error?: string;
}) {
  const p50 = percentile(payload.timings.liveLatenciesMs, 50);
  const p95 = percentile(payload.timings.liveLatenciesMs, 95);
  const failed = Object.values(payload.steps).some((v) => v === "FAIL");
  const report = {
    runId: smokeRunId,
    executed: true,
    ticket: "#110",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "https://www.meethint.ai",
    profile: "Playwright Chrome persistent profile (.grok/smoke-profile-{a|b})",
    accountType: "Google OAuth (real production accounts)",
    result: failed ? "FAIL" : "PASS",
    steps: payload.steps,
    timings: {
      ...payload.timings,
      liveP50Ms: p50,
      liveP95Ms: p95,
    },
    spaceId: payload.spaceId ?? null,
    error: payload.error ?? null,
    recordedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}
