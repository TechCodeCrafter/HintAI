import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { fillCreateContextIdentity, installE2eMocks } from "./fixtures/helpers";
import { writeSyntheticRepo, type SyntheticRepo } from "./fixtures/synthetic-repo";

/**
 * Measures a large folder in a real browser tab: how long it takes to become
 * Ready, how long a question takes once it is, and how much memory the tab
 * uses. Not part of the test run; it reports numbers and fails only when the
 * search budget is missed.
 *
 *   LARGE_REPO_BENCH=1 npx playwright test large-repo-bench --project=chromium --workers=1
 *
 *   LARGE_REPO_BENCH_SIZES=1500,2500   files in each fixture (default)
 *   LARGE_REPO_BENCH_MEAN_BYTES=5200   mean size of a source file (default)
 *   LARGE_REPO_BENCH_EMBEDDER=none     "none": the embedding model is left
 *                                      as the app ships it. "mock": every
 *                                      chunk gets a stand-in 384-wide vector,
 *                                      so the vector path and its memory are
 *                                      measured, not the model.
 *
 * The answer model is mocked (it declines), so a question is answered from
 * the local card. The time reported is the search and the local answer; a
 * model call is on top of it and is not what this measures.
 *
 * Results are printed and written to test-results/large-repo-bench.json.
 */
const ENABLED = Boolean(process.env.LARGE_REPO_BENCH);
const SIZES = (process.env.LARGE_REPO_BENCH_SIZES ?? "1500,2500").split(",").map((value) => Number(value.trim()));
const EMBEDDER = process.env.LARGE_REPO_BENCH_EMBEDDER === "mock" ? "mock" : "none";
const MEAN_BYTES = Number(process.env.LARGE_REPO_BENCH_MEAN_BYTES ?? 0);
const SEARCH_BUDGET_MS = 400;

test.skip(!ENABLED, "set LARGE_REPO_BENCH=1 to run the large-repo measurement");
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);
test.use({
  launchOptions: { args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] },
});

type Mark = { at: number; label: string };
type Question = { ms: number; cardMs: number; said: boolean; cited: boolean; lexicalOnly: boolean; reason: string | null };
type BenchWindow = {
  __bench: { marks: Mark[]; longest: number; blocked: number; heapPeak: number };
  __questions: Question[] | null;
  useMeetHint: {
    getState: () => {
      search: (q?: string) => Promise<void>;
      card: { say?: string; reason?: string; latencyMs: number; lexicalOnly?: boolean; citations: Array<{ path: string }> } | null;
      hydrationEpoch: number;
      chunks: unknown[];
      sources: unknown[];
      loadingFolder: boolean;
      contextStatus: string;
      indexActivity: { phase: string } | null;
      warm: { words: { ready: boolean }; vectors: { state: string } };
    };
    subscribe: (fn: () => void) => () => void;
  };
};

/** Marks the steps of a load as the store goes through them, and the longest stretch the page could not respond. */
async function installBenchProbes(page: Page) {
  await installE2eMocks(page);
  if (EMBEDDER === "none") {
    await page.addInitScript(() => {
      delete (window as { __mockEmbedder?: unknown }).__mockEmbedder;
    });
  }
  await page.addInitScript(() => {
    const w = window as unknown as BenchWindow;
    const bench = { marks: [] as Mark[], longest: 0, blocked: 0, heapPeak: 0 };
    w.__bench = bench;
    const seen = new Set<string>();
    const mark = (label: string) => {
      if (seen.has(label)) return;
      seen.add(label);
      bench.marks.push({ at: performance.now(), label });
    };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          bench.longest = Math.max(bench.longest, entry.duration);
          bench.blocked += entry.duration;
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* longtask is not supported everywhere */
    }
    const heap = () => {
      const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
      if (memory) bench.heapPeak = Math.max(bench.heapPeak, memory.usedJSHeapSize);
    };
    setInterval(heap, 100);
    const attach = () => {
      if (!w.useMeetHint) return void setTimeout(attach, 20);
      const read = () => {
        const state = w.useMeetHint.getState();
        if (state.loadingFolder) mark("load");
        if (state.indexActivity) mark(state.indexActivity.phase);
        if (seen.has("load") && !state.loadingFolder && state.contextStatus === "ready") {
          mark("indexed");
          if (state.warm.words.ready) mark("words");
        }
        heap();
      };
      w.useMeetHint.subscribe(read);
      read();
    };
    attach();
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="indexing-complete"]')) mark("ready");
      if (document.querySelector('[data-testid="index-chip"][data-ready="true"]')) mark("chip-ready");
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
}

/** Resident memory of the largest renderer process, in bytes. The tab under test is the only one with any weight. */
async function rendererRss(browser: Browser): Promise<number> {
  try {
    const session = await browser.newBrowserCDPSession();
    const info = (await session.send("SystemInfo.getProcessInfo")) as { processInfo: Array<{ type: string; id: number }> };
    await session.detach();
    const pids = info.processInfo.filter((process) => process.type === "renderer").map((process) => String(process.id));
    if (pids.length === 0) return 0;
    const out = execFileSync("ps", ["-o", "rss=", "-p", pids.join(",")], { encoding: "utf8" });
    return Math.max(0, ...out.split("\n").map((line) => Number(line.trim()) * 1024).filter(Number.isFinite));
  } catch {
    return 0;
  }
}

/** Samples memory from outside the page, so a page that is busy is still measured. */
function memorySampler(browser: Browser, page: Page) {
  let heapPeak = 0;
  let rssPeak = 0;
  let stopped = false;
  const cdp = page.context().newCDPSession(page);
  const loop = (async () => {
    const session = await cdp;
    await session.send("Performance.enable");
    while (!stopped) {
      try {
        const { metrics } = await session.send("Performance.getMetrics");
        heapPeak = Math.max(heapPeak, metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0);
      } catch {
        /* the page navigated; the next sample reads the new one */
      }
      rssPeak = Math.max(rssPeak, await rendererRss(browser));
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  })();
  return {
    peak: () => ({ heapPeak, rssPeak }),
    reset: () => {
      heapPeak = 0;
      rssPeak = 0;
    },
    /** Heap in use after a collection: what the tab holds on to, not what it passed through. */
    settled: async () => {
      const session = await cdp;
      await session.send("HeapProfiler.collectGarbage");
      await session.send("HeapProfiler.collectGarbage");
      const { metrics } = await session.send("Performance.getMetrics");
      return metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0;
    },
    stop: async () => {
      stopped = true;
      await loop;
    },
  };
}

/**
 * LARGE_REPO_BENCH_PROFILE=load or =search writes a CPU profile of that step
 * to test-results/. Profiling slows the step it measures, so the timings of
 * a profiled run are not the ones to report.
 */
async function cpuProfile(page: Page, step: "load" | "search", size: number): Promise<() => Promise<void>> {
  if (process.env.LARGE_REPO_BENCH_PROFILE !== step) return async () => undefined;
  const session = await page.context().newCDPSession(page);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 200 });
  await session.send("Profiler.start");
  return async () => {
    const { profile } = await session.send("Profiler.stop");
    mkdirSync("test-results", { recursive: true });
    writeFileSync(join("test-results", `large-repo-${step}-${size}.cpuprofile`), JSON.stringify(profile));
    await session.detach();
  };
}

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

/** Ask every question in turn, in the page, and leave the timings on `window` for the test to read. */
async function askAll(page: Page, repo: SyntheticRepo): Promise<Question[]> {
  await page.evaluate((facts) => {
    const w = window as unknown as BenchWindow;
    w.__questions = null;
    void (async () => {
      const out: Question[] = [];
      for (const fact of facts) {
        const started = performance.now();
        await w.useMeetHint.getState().search(fact.question);
        const ms = performance.now() - started;
        const card = w.useMeetHint.getState().card;
        out.push({
          ms,
          cardMs: card?.latencyMs ?? -1,
          said: Boolean(card?.say),
          cited: Boolean(card?.citations.some((cite) => cite.path.endsWith(fact.path))),
          lexicalOnly: Boolean(card?.lexicalOnly),
          reason: card ? (card.say ? null : (card.reason ?? "silent")) : "no card",
        });
      }
      w.__questions = out;
    })();
  }, repo.facts);
  const read = () => page.evaluate(() => (window as unknown as BenchWindow).__questions);
  await expect.poll(async () => (await read()) !== null, { timeout: 300_000, intervals: [250] }).toBe(true);
  return (await read())!;
}

/**
 * The space is open and settled: the cockpit is ready, the chip says Ready,
 * and no load started in the last half second. Opening a space from the
 * create flow hydrates it once more, and a question asked before that ends
 * is dropped.
 */
async function waitSettled(page: Page) {
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", { timeout: 300_000 });
  const snapshot = () =>
    page.evaluate(() => {
      const state = (window as unknown as BenchWindow).useMeetHint.getState();
      const chip = document.querySelector<HTMLElement>('[data-testid="index-chip"]');
      return `${state.hydrationEpoch}|${state.contextStatus}|${chip?.dataset.ready ?? ""}`;
    });
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await snapshot();
        const stable = now === last && now.endsWith("|ready|true");
        last = now;
        return stable;
      },
      { timeout: 300_000, intervals: [500] },
    )
    .toBe(true);
}

const results: Array<Record<string, unknown>> = [];

test.afterAll(() => {
  if (results.length === 0) return;
  mkdirSync("test-results", { recursive: true });
  writeFileSync(join("test-results", "large-repo-bench.json"), `${JSON.stringify({ embedder: EMBEDDER, results }, null, 2)}\n`);
  console.log(`\nLarge-repo measurement (embedder: ${EMBEDDER})`);
  console.table(results);
});

for (const size of SIZES) {
  test(`${size} files: time to Ready, search latency, memory`, async ({ page, browser }) => {
    const repo = writeSyntheticRepo({ files: size, withSkipped: true, ...(MEAN_BYTES ? { meanBytes: MEAN_BYTES } : {}) });
    const memory = memorySampler(browser, page);
    try {
      await installBenchProbes(page);
      await e2eSignIn(page, USER_A);
      await page.goto("/create");
      await fillCreateContextIdentity(page, `bench-${size}-${Date.now()}`);
      const baseline = await memory.settled();
      memory.reset();

      const picked = Date.now();
      await page.getByTestId("folder-input").setInputFiles(repo.folder);
      await expect(page.getByTestId("review-pack-dialog")).toBeVisible({ timeout: 120_000 });
      const scanMs = Date.now() - picked;
      const stopLoadProfile = await cpuProfile(page, "load", size);
      await page.getByTestId("review-pack-index").click();
      await page.getByTestId("indexing-complete").waitFor({ timeout: 600_000 });
      await stopLoadProfile();

      const bench = await page.evaluate(() => (window as unknown as BenchWindow).__bench);
      const at = (label: string) => bench.marks.find((mark) => mark.label === label)?.at ?? NaN;
      const start = at("load");
      const load = memory.peak();
      const state = await page.evaluate(() => {
        const s = (window as unknown as BenchWindow).useMeetHint.getState();
        return { chunks: s.chunks.length, sources: s.sources.length, vectors: s.warm.vectors.state };
      });

      const doneAt = Date.now();
      await page.getByTestId("indexing-done").click();
      await waitSettled(page);
      const openMs = Date.now() - doneAt;
      const chipText = (await page.getByTestId("index-chip-text").innerText()).trim();
      const phase = (await page.getByTestId("index-chip-phase").innerText()).trim();
      const settledHeap = await memory.settled();

      memory.reset();
      const stopSearchProfile = await cpuProfile(page, "search", size);
      const questions = await askAll(page, repo);
      await stopSearchProfile();
      const search = memory.peak();
      const times = questions.map((question) => question.ms);
      console.log(`${size} files, questions (ms): ${times.map((ms) => Math.round(ms)).join(" ")}`);
      const missed = questions.filter((question) => !question.cited);
      if (missed.length > 0) console.log(`${size} files, not answered from the right file: ${missed.map((question) => question.reason ?? "cited another file").join(" | ")}`);

      // Open the space again from cold: everything is read back from storage.
      memory.reset();
      const reloadAt = Date.now();
      await page.reload();
      await waitSettled(page);
      const reopenMs = Date.now() - reloadAt;
      const reopen = memory.peak();
      const again = await askAll(page, repo);
      console.log(`${size} files, questions after reopening (ms): ${again.map((question) => Math.round(question.ms)).join(" ")}`);

      results.push({
        files: size,
        MB: +(repo.bytes / 1e6).toFixed(1),
        chunks: state.chunks,
        stored: state.sources,
        chip: `${phase} · ${chipText}`,
        "scan ms": scanMs,
        "read ms": Math.round(at("saving") - start),
        "save ms": Math.round(at("indexing") - at("saving")),
        "index ms": Math.round(at("indexed") - at("indexing")),
        "warm ms": Math.round(at("ready") - at("indexed")),
        "Ready s": +((at("ready") - start) / 1000).toFixed(1),
        "open ms": openMs,
        "longest block ms": Math.round(bench.longest),
        "search p50": Math.round(percentile(times, 50)),
        "search p95": Math.round(percentile(times, 95)),
        "search max": Math.round(Math.max(...times)),
        "first q ms": Math.round(times[0]),
        "right file": `${questions.filter((question) => question.cited).length}/${questions.length}`,
        "peak heap MB": mb(Math.max(load.heapPeak, bench.heapPeak)),
        "peak RSS MB": mb(load.rssPeak),
        "settled heap MB": mb(settledHeap),
        "baseline heap MB": mb(baseline),
        "search RSS MB": mb(search.rssPeak),
        "reopen s": +(reopenMs / 1000).toFixed(1),
        "reopen heap MB": mb(reopen.heapPeak),
        "reopen search p95": Math.round(percentile(again.map((question) => question.ms), 95)),
      });

      expect(state.sources, "every file in the fixture is stored").toBe(size);
      expect(Math.max(...times), "search stays inside the budget once Ready").toBeLessThan(SEARCH_BUDGET_MS);
    } finally {
      await memory.stop();
      repo.remove();
    }
  });
}
