import { expect, test, type Page } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { installE2eMocks } from "./fixtures/helpers";
import { writeSyntheticRepo } from "./fixtures/synthetic-repo";

/**
 * The embedding model itself, with nothing standing in for it.
 *
 * Every other browser test replaces the model with `window.__mockEmbedder`,
 * so none of them can see whether the model the app ships with loads at all.
 * This one removes the stand-in. It checks that the model's runtime comes
 * from this origin, that it runs off the page's thread, and that a space goes
 * from word search to hybrid on its own once its vectors are in.
 *
 * Opt-in, because the model's weights are fetched from huggingface.co the
 * first time a browser sees them:
 *
 *   REAL_EMBEDDER=1 npx playwright test e2e/listen-real-embedder.spec.ts --project=chromium
 */
const ENABLED = Boolean(process.env.REAL_EMBEDDER);
const FILES = Number(process.env.REAL_EMBEDDER_FILES ?? 30);

/** The budget for a first question, in milliseconds. */
const FIRST_ANSWER_MS = 1200;
/**
 * The longest the page's thread may be held while chunks are embedded. With
 * the model on the page it was held for 2,200 to 3,600 ms at a time.
 */
const LONGEST_TASK_MS = 1000;

type CardView = { say?: string; reason?: string; lexicalOnly?: boolean; latencyMs: number; citations: Array<{ path: string }> };
type StoreView = {
  chunks: unknown[];
  card: CardView | null;
  search: (text: string) => Promise<void>;
  warm: { words: { ready: boolean }; vectors: { state: string; have: number; total: number } };
};
type TestWindow = { useMeetHint: { getState: () => StoreView }; __long: number[]; __mockEmbedder?: unknown };

const vectors = (page: Page) =>
  page.evaluate(() => (window as unknown as TestWindow).useMeetHint.getState().warm.vectors);

/** Ask, and time it in the page. */
async function ask(page: Page, question: string) {
  return page.evaluate(async (text) => {
    const hint = (window as unknown as TestWindow).useMeetHint;
    const before = hint.getState().warm.vectors.state;
    const started = performance.now();
    await hint.getState().search(text);
    const card = hint.getState().card;
    return {
      ms: Math.round(performance.now() - started),
      vectorsBefore: before,
      lexicalOnly: Boolean(card?.lexicalOnly),
      answered: Boolean(card?.say),
      reason: card?.reason ?? "",
      paths: (card?.citations ?? []).map((cite) => cite.path),
    };
  }, question);
}

test("the real embedding model loads from this origin, runs off the page, and takes a space from word search to hybrid", async ({ page }) => {
  test.skip(!ENABLED, "Set REAL_EMBEDDER=1 to run. It downloads the model from huggingface.co.");
  test.setTimeout(600_000);

  const repo = writeSyntheticRepo({ files: FILES });
  const requested: string[] = [];
  const refused: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) refused.push(message.text().slice(0, 240));
  });

  try {
    await installE2eMocks(page);
    await page.addInitScript(() => {
      const w = window as unknown as TestWindow;
      delete w.__mockEmbedder;
      w.__long = [];
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) w.__long.push(Math.round(entry.duration));
        }).observe({ entryTypes: ["longtask"] });
      } catch {
        // No long-task timing in this browser: the check below has nothing to read.
      }
    });
    await e2eSignIn(page, USER_A);
    await page.goto("/app");
    await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", { timeout: 30000 });

    await page.getByTestId("folder-input").first().setInputFiles(repo.folder);
    await expect(page.getByTestId("review-pack-dialog")).toBeVisible({ timeout: 120000 });
    await page.getByTestId("review-pack-index").click();

    const chip = page.getByTestId("index-chip").first();
    const phase = page.getByTestId("index-chip-phase").first();
    const listen = page.getByTestId("listen-button").first();

    // Ready, on whichever search is in memory. Listen follows the chip.
    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as TestWindow).useMeetHint.getState().chunks.length)) > 100, {
        timeout: 120000,
      })
      .toBe(true);
    await expect(chip).toHaveAttribute("data-ready", "true", { timeout: 120000 });
    await expect(listen).toBeEnabled();
    const atReady = await vectors(page);
    await page.evaluate(() => {
      (window as unknown as TestWindow).__long.length = 0;
    });

    // The first question is answered now, whatever the vectors are doing, and
    // the card says which search answered it.
    const fact = repo.facts[0]!;
    const first = await ask(page, fact.question);
    test.info().annotations.push({
      type: "first question",
      description: `${first.ms} ms, vectors ${first.vectorsBefore} (${atReady.have}/${atReady.total}), ${first.lexicalOnly ? "word search only" : "hybrid"}`,
    });
    expect(first.ms).toBeLessThan(FIRST_ANSWER_MS);
    expect(first.answered || first.reason !== "").toBe(true);
    expect(first.lexicalOnly).toBe(first.vectorsBefore !== "ready");
    if (first.lexicalOnly) {
      await expect(phase).toHaveText("Ready · word search");
      await expect(page.getByTestId("card").getByTestId("lexical-only-note")).toHaveText("Word search only");
    }
    if (first.answered) expect(first.paths.some((path) => path.endsWith(fact.path))).toBe(true);

    // Nothing is clicked. The model finishes the folder and the chip says Ready.
    // A runtime the browser refused to fetch ends the wait at once: the model
    // will never load, and the chip would sit on word search until the timeout.
    const started = Date.now();
    while ((await phase.textContent()) !== "Ready") {
      expect(refused, "the browser refused something the model needs").toEqual([]);
      expect(Date.now() - started, "the vectors never finished").toBeLessThan(480_000);
      await page.waitForTimeout(500);
    }
    const done = await vectors(page);
    expect(done.state).toBe("ready");
    expect(done.have).toBe(done.total);
    expect(done.total).toBeGreaterThan(100);
    await expect(listen).toBeEnabled();

    // Embedding did not hold the page.
    const long = await page.evaluate(() => (window as unknown as TestWindow).__long.slice());
    test.info().annotations.push({
      type: "embedding",
      description: `${done.total} chunks in ${((Date.now() - started) / 1000).toFixed(1)} s after the first question; ${long.length} long tasks on the page, longest ${Math.max(0, ...long)} ms`,
    });
    expect(Math.max(0, ...long)).toBeLessThan(LONGEST_TASK_MS);

    // The next question is hybrid, and is not marked.
    const next = repo.facts[1] ?? fact;
    const second = await ask(page, next.question);
    test.info().annotations.push({ type: "second question", description: `${second.ms} ms, hybrid` });
    expect(second.vectorsBefore).toBe("ready");
    expect(second.lexicalOnly).toBe(false);
    expect(second.ms).toBeLessThan(FIRST_ANSWER_MS);
    await expect(page.getByTestId("lexical-only-note")).toHaveCount(0);
    if (second.answered) expect(second.paths.some((path) => path.endsWith(next.path))).toBe(true);

    // The model ran in a worker, on a runtime served from this origin.
    const origin = new URL(page.url()).origin;
    expect(page.workers().some((worker) => /embed-worker/.test(worker.url()))).toBe(true);
    expect(requested.filter((url) => /jsdelivr|unpkg|cdnjs/.test(url))).toEqual([]);
    expect(requested.some((url) => url.startsWith(`${origin}/vad/`) && /ort-wasm.*\.wasm/.test(url))).toBe(true);
    expect(refused).toEqual([]);
    // The only other host is the one the weights come from.
    const hosts = [...new Set(requested.map((url) => new URL(url).host).filter((host) => host !== new URL(origin).host))];
    expect(hosts.filter((host) => !/(^|\.)huggingface\.co$|(^|\.)hf\.co$/.test(host))).toEqual([]);

    // Opened again, the vectors come from this browser: hybrid from the first question.
    await page.reload();
    await expect(phase).toHaveText("Ready", { timeout: 120000 });
    const reopened = await vectors(page);
    expect(reopened.have).toBe(done.total);
    const again = await ask(page, fact.question);
    test.info().annotations.push({ type: "first question after reopening", description: `${again.ms} ms, hybrid` });
    expect(again.lexicalOnly).toBe(false);
    expect(again.ms).toBeLessThan(FIRST_ANSWER_MS);
  } finally {
    repo.remove();
  }
});
