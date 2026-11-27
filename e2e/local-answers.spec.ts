import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { FILES, LATER_COMMITS, writeAnswersRepo } from "./fixtures/answers-repo";
import { fillCreateContextIdentity, installE2eMocks, typeQuestion, waitForIndexing } from "./fixtures/helpers";

const TWO_PART = "How many times is a failed export retried and what happens after the last attempt?";
const RETRIED = "How many times is a failed export retried?";
const COOKIE = "When does a session cookie expire?";
const FOLLOW_UP = "What about the error handling?";

type CardView = {
  say: string | null;
  query: string | null;
  reason: string | null;
  modelFallback: string | null;
  citations: { path: string; line: number | null }[];
};

type View = {
  card: CardView | null;
  route: string | null;
  memory: number;
  chunkPaths: string[];
  recency: [string, number][];
  subscription: string;
  upgradeFeature: string | null;
  details: { topHits: { path: string; boosts?: Record<string, number> }[] } | null;
};

function view(page: Page): Promise<View> {
  return page.evaluate(() => {
    const state = window.useMeetHint?.getState() as unknown as {
      card: {
        say?: string;
        query?: string;
        reason?: string;
        modelFallback?: string;
        citations?: { kind: string; path?: string; line?: number }[];
      } | null;
      lastSearchRoute: string | null;
      memory: unknown[];
      chunks: { path: string }[];
      recency: { byPath: Map<string, number> } | null;
      subscription: string;
      upgradeFeature: string | null;
      searchDetails: { topHits: { path: string; boosts?: Record<string, number> }[] } | null;
    };
    return {
      card: state.card
        ? {
            say: state.card.say ?? null,
            query: state.card.query ?? null,
            reason: state.card.reason ?? null,
            modelFallback: state.card.modelFallback ?? null,
            citations: (state.card.citations ?? []).map((c) => ({ path: c.path ?? "", line: c.line ?? null })),
          }
        : null,
      route: state.lastSearchRoute,
      memory: state.memory.length,
      chunkPaths: [...new Set(state.chunks.map((chunk) => chunk.path))],
      recency: [...(state.recency?.byPath ?? new Map<string, number>())],
      subscription: state.subscription,
      upgradeFeature: state.upgradeFeature,
      details: state.searchDetails,
    };
  });
}

/** Asks in the cockpit and waits for the Card that answers this question, spoken or silent. */
async function ask(page: Page, question: string): Promise<View> {
  await typeQuestion(page, question);
  await expect
    .poll(async () => {
      const now = await view(page);
      return now.card?.query === question && Boolean(now.card.say || now.card.reason);
    }, { timeout: 20000 })
    .toBe(true);
  return view(page);
}

async function loadRepo(page: Page): Promise<string> {
  await installE2eMocks(page);
  // Count every call that would have gone to the model.
  await page.addInitScript(() => {
    const calls = { count: 0 };
    (window as unknown as { __modelCalls: { count: number } }).__modelCalls = calls;
    window.__mockCraftCard = async () => {
      calls.count += 1;
      return { say: "INSUFFICIENT" };
    };
  });
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await fillCreateContextIdentity(page, `answers-${Date.now()}`);
  const folder = writeAnswersRepo();
  await page.getByTestId("folder-input").setInputFiles(folder);
  await expect(page.getByTestId("review-pack-dialog")).toBeVisible();
  await page.getByTestId("review-pack-index").click();
  await waitForIndexing(page);
  await page.getByTestId("indexing-done").click();
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", { timeout: 30000 });
  return folder;
}

const endsWith = (suffix: string) => (path: string) => path.endsWith(suffix);
const modelCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __modelCalls: { count: number } }).__modelCalls.count);

test("a folder with git history: recent commits and declared names rank, nothing under .git is loaded", async ({ page }) => {
  test.setTimeout(180_000);
  const folder = await loadRepo(page);
  // The fixture really has both object forms on disk.
  expect(readdirSync(join(folder, ".git", "objects", "pack")).some((name) => name.endsWith(".pack"))).toBe(true);
  expect(readdirSync(join(folder, ".git", "objects")).some((name) => /^[0-9a-f]{2}$/.test(name))).toBe(true);

  const loaded = await view(page);
  expect(loaded.chunkPaths.map((path) => path.replace(/^[^/]+\//, "")).sort()).toEqual(Object.keys(FILES).sort());
  expect(loaded.chunkPaths.some((path) => path.includes(".git"))).toBe(false);

  // Two commits after the first: each file they touched, the newest highest.
  // The first commit has no parent to compare with and reports nothing.
  const recency = new Map(loaded.recency);
  expect([...recency.keys()].map((path) => path.replace(/^[^/]+\//, "")).sort()).toEqual([...LATER_COMMITS].sort());
  for (const path of recency.keys()) expect(loaded.chunkPaths).toContain(path);
  const newest = loaded.recency.find(([path]) => path.endsWith(LATER_COMMITS[1]))![1];
  const older = loaded.recency.find(([path]) => path.endsWith(LATER_COMMITS[0]))![1];
  expect(newest).toBe(1);
  expect(older).toBeGreaterThan(0);
  expect(older).toBeLessThan(newest);

  await page.getByTestId("search-details-toggle").click();
  const cookie = await ask(page, COOKIE);
  expect(cookie.card?.say).toBe("Sessions are stored in an encrypted cookie that expires after twelve hours.");
  const top = cookie.details!.topHits[0]!;
  expect(top.path).toMatch(/src\/auth\/session\.ts$/);
  expect(top.boosts?.recentCommit ?? 0).toBeGreaterThan(0);
  expect(top.boosts?.recentCommit ?? 0).toBeLessThanOrEqual(1);
  // `issueSession` is declared in that chunk, and the question says "session".
  expect(top.boosts?.declares ?? 0).toBeGreaterThan(0);

  // A file no recent commit touched gets no such credit.
  const retried = await ask(page, RETRIED);
  const retryHit = retried.details!.topHits.find((hit) => hit.path.endsWith("src/export/retry.ts"))!;
  expect(retryHit.boosts?.recentCommit).toBeUndefined();
  expect(retryHit.boosts?.declares ?? 0).toBeGreaterThan(0);
});

test("a two-part question is answered from two cited passages, shown on demand, also offline", async ({ page, context }) => {
  test.setTimeout(180_000);
  await loadRepo(page);

  const answered = await ask(page, TWO_PART);
  expect(answered.card?.say).toBe(
    "Retries a failed export up to three times with exponential backoff. After the last attempt the export job is moved to the dead letter queue.",
  );
  expect(answered.card?.citations.map((c) => `${c.path.replace(/^[^/]+\//, "")}:${c.line}`)).toEqual([
    "src/export/retry.ts:2",
    "src/export/retry.ts:11",
  ]);
  expect(await modelCalls(page)).toBe(0);
  const card = page.getByTestId("card");
  await expect(card.getByTestId("card-citation")).toHaveCount(2);

  // Closed until asked for. The keyboard opens it.
  const why = card.getByTestId("card-why");
  await expect(why.getByTestId("card-why-text").first()).toBeHidden();
  await why.getByTestId("card-why-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(why.getByTestId("card-why-span")).toHaveCount(2);
  // Each passage is headed by the sentence that was spoken from it.
  await expect(why.getByTestId("card-why-said")).toHaveText([
    /Retries a failed export up to three times with exponential backoff\.$/,
    /After the last attempt the export job is moved to the dead letter queue\.$/,
  ]);
  // Each passage is the file's own text, and what is marked in it is in the spoken line.
  const file = FILES["src/export/retry.ts"];
  const passages = await why.getByTestId("card-why-text").allInnerTexts();
  expect(passages).toHaveLength(2);
  for (const passage of passages) expect(file).toContain(passage.trim());
  const marks = (await why.getByTestId("card-why-mark").allInnerTexts()).map((mark) => mark.toLowerCase());
  // One exact span per passage: the sentence that was read out from it.
  expect(marks).toEqual([
    "retries a failed export up to three times with exponential backoff",
    "after the last attempt the export job is moved to the dead letter queue",
  ]);
  await expect(why.locator('[data-testid="card-why-mark"][data-exact="true"]')).toHaveCount(2);
  const spoken = answered.card!.say!.toLowerCase();
  for (const mark of marks) expect(spoken).toContain(mark);
  await expect(why.getByTestId("card-why-where").first()).toContainText("src/export/retry.ts");

  // With the network gone: a new question is answered and its passages open.
  await context.setOffline(true);
  const offline = await ask(page, COOKIE);
  expect(offline.card?.say).toBe("Sessions are stored in an encrypted cookie that expires after twelve hours.");
  const again = page.getByTestId("card").getByTestId("card-why");
  await again.getByTestId("card-why-toggle").click();
  await expect(again.getByTestId("card-why-span")).toHaveCount(1);
  expect(FILES["src/auth/session.ts"]).toContain((await again.getByTestId("card-why-text").innerText()).trim());
  await context.setOffline(false);
});

test("a follow-up is answered from the file the thread was about, and three turns are kept", async ({ page }) => {
  test.setTimeout(180_000);
  await loadRepo(page);

  const first = await ask(page, RETRIED);
  expect(first.card?.say).toBe("Retries a failed export up to three times with exponential backoff.");
  expect(first.route).toBe("full");
  expect(first.memory).toBe(1);

  const exportFollowUp = await ask(page, FOLLOW_UP);
  expect(exportFollowUp.route).toBe("thread");
  expect(exportFollowUp.card?.say).toBe(
    "Error handling for exports: a timeout is retried, and a validation error fails the job at once.",
  );
  expect(exportFollowUp.card?.citations.map((c) => c.path).every(endsWith("src/export/retry.ts"))).toBe(true);

  // A question that leans on nothing is searched in full.
  const cookie = await ask(page, COOKIE);
  expect(cookie.route).toBe("full");
  expect(cookie.card?.citations.map((c) => c.path).every(endsWith("src/auth/session.ts"))).toBe(true);

  // The same follow-up words now stay with sign-in.
  const authFollowUp = await ask(page, FOLLOW_UP);
  expect(authFollowUp.route).toBe("thread");
  expect(authFollowUp.card?.say).toBe(
    "Error handling for sign-in: a bad password locks the account after five attempts.",
  );
  expect(authFollowUp.card?.citations.map((c) => c.path).every(endsWith("src/auth/session.ts"))).toBe(true);

  // Four answers were spoken. The last three are kept.
  expect(authFollowUp.memory).toBe(3);
  expect(await modelCalls(page)).toBe(0);
});

test("with the daily limit spent, questions are still answered from the files and no model is called", async ({ page }) => {
  test.setTimeout(180_000);
  await loadRepo(page);
  expect((await view(page)).subscription).toBe("free");

  // Spend today's allowance where the app keeps it: beside the session, under the account.
  const spent = await page.evaluate(() => {
    const sessionKey = Object.keys(localStorage).find((key) => key.includes("meethint.session"));
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const key = (sessionKey ?? "meethint.session").replace("meethint.session", "meethint.extractQuota");
    localStorage.setItem(key, JSON.stringify({ day, used: 1000 }));
    return { key, hadSession: Boolean(sessionKey) };
  });
  expect(spent.key).toContain("meethint.extractQuota");

  const answered = await ask(page, TWO_PART);
  expect(answered.card?.say).toBe(
    "Retries a failed export up to three times with exponential backoff. After the last attempt the export job is moved to the dead letter queue.",
  );
  expect(answered.card?.citations).toHaveLength(2);
  expect(answered.card?.reason).toBeNull();
  expect(answered.upgradeFeature).not.toBe("extract-limit");
  expect(await modelCalls(page)).toBe(0);
  // The note that the model was not used is on the Card exactly when the Card says so.
  await expect(page.getByTestId("model-fallback-note")).toHaveCount(answered.card?.modelFallback ? 1 : 0);

  // Nothing in the files covers this, and the model is not asked instead.
  const silent = await ask(page, "What is the refund policy for annual plans?");
  expect(silent.card?.say).toBeNull();
  expect(silent.card?.reason).toBeTruthy();
  expect(await modelCalls(page)).toBe(0);
});
