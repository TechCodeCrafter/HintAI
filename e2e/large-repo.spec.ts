import { expect, test, type Page } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { installE2eMocks } from "./fixtures/helpers";
import { writeSyntheticRepo, type SyntheticRepo } from "./fixtures/synthetic-repo";

/**
 * A real engineering repository: more files than the old 500-file limit.
 *
 * The folder loads whole and the chip counts it up while it does. Every file
 * that is left out is listed under the chip with the reason. A question is
 * answered inside the budget once the chip says Ready. Opening another space
 * while a load runs stops the load and leaves nothing half-shown.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(420_000);

/** The budget for a question once the chip says Ready, in milliseconds. */
const SEARCH_BUDGET_MS = 400;
/** What one selection could hold before the limits were raised. */
const OLD_FILE_LIMIT = 500;

type Activity = { phase: "reading" | "saving" | "indexing"; done?: number; total?: number | null } | null;
type StoreView = {
  activeSpaceId: string | null;
  contextStatus: string;
  contextUpdating: boolean;
  loadingFolder: boolean;
  hydrationEpoch: number;
  indexActivity: Activity;
  packNotice: string | null;
  folderError: string | null;
  sources: Array<{ path: string }>;
  chunks: unknown[];
  contexts: Array<{ id: string }>;
  loadSkipped: { spaceId: string; files: Array<{ path: string; reason: string; count?: number }> } | null;
  card: { say?: string; reason?: string; citations: Array<{ path: string }> } | null;
  search: (question?: string) => Promise<void>;
  loadFolder: (files: File[]) => Promise<{ ok: boolean; contextId: string | null }>;
  activateSpace: (id: string) => Promise<void>;
};
type Asked = { ms: number; cited: boolean; said: boolean };
type TestWindow = {
  useMeetHint: { getState: () => StoreView; subscribe: (fn: (state: StoreView) => void) => () => void };
  __chipTexts: string[];
  __asked: Asked[] | null;
  __switched: { phase: string; done: number; total: number; from: string | null } | null;
  __stopped: { done: number; total: number; button: boolean } | null;
  __folderLimits?: { maxFiles?: number; maxTotalBytes?: number };
};

function store<T>(page: Page, read: (state: StoreView) => T): Promise<T> {
  return page.evaluate(
    (source) => new Function("state", `return (${source})(state)`)((window as unknown as TestWindow).useMeetHint.getState()) as T,
    read.toString(),
  );
}

/** Folders this run wrote, removed after each test. */
const written: SyntheticRepo[] = [];
test.afterEach(() => {
  for (const repo of written.splice(0)) repo.remove();
});
function fixture(options: Parameters<typeof writeSyntheticRepo>[0]): SyntheticRepo {
  const repo = writeSyntheticRepo(options);
  written.push(repo);
  return repo;
}

/**
 * The cockpit, signed in, with search as the app ships it: the stand-in
 * embedder the other browser tests use is taken out, so questions are ranked
 * the way they are for a person (the chip settles on "Ready · word search").
 */
async function openCockpit(page: Page) {
  await installE2eMocks(page);
  await page.addInitScript(() => {
    delete (window as { __mockEmbedder?: unknown }).__mockEmbedder;
  });
  await e2eSignIn(page, USER_A);
  await page.goto("/app");
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", { timeout: 30_000 });
}

/** Before any page script: every line the chip shows, in order. */
async function recordChip(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as TestWindow;
    const texts: string[] = [];
    w.__chipTexts = texts;
    const sample = () => {
      const text = document.querySelector('[data-testid="index-chip-text"]')?.textContent?.trim();
      if (text && texts.at(-1) !== text) texts.push(text);
    };
    new MutationObserver(sample).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

/** Pick a folder in the cockpit and agree to index it. */
async function pickFolder(page: Page, repo: SyntheticRepo) {
  await page.getByTestId("folder-input").first().setInputFiles(repo.folder);
  await expect(page.getByTestId("review-pack-dialog")).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("review-pack-index").click();
}

/** The chip says Ready and no load has started in the last half second. */
async function waitReady(page: Page) {
  const snapshot = () =>
    page.evaluate(() => {
      // Just after a reload the page has no store yet.
      const state = (window as unknown as Partial<TestWindow>).useMeetHint?.getState();
      if (!state) return "";
      const chip = document.querySelector<HTMLElement>('[data-testid="index-chip"]');
      return `${state.hydrationEpoch}|${state.contextStatus}|${state.loadingFolder}|${state.contextUpdating}|${chip?.dataset.ready ?? ""}`;
    });
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await snapshot();
        const stable = now === last && now.endsWith("|ready|false|false|true");
        last = now;
        return stable;
      },
      { timeout: 300_000, intervals: [500] },
    )
    .toBe(true);
}

/** The numbers a line like "Reading 300 of 1,500 files…" counted through. */
function counted(texts: string[], verb: "Reading" | "Indexing", total: number): number[] {
  const line = new RegExp(`^${verb} ([\\d,]+) of ${total.toLocaleString("en-US")} files`);
  return texts.flatMap((text) => {
    const match = line.exec(text);
    return match ? [Number(match[1].replaceAll(",", ""))] : [];
  });
}

/** Ask each question in the page, one after the other, and time it there. */
async function askAll(page: Page, facts: SyntheticRepo["facts"]): Promise<Asked[]> {
  await page.evaluate((list) => {
    const w = window as unknown as TestWindow;
    w.__asked = null;
    void (async () => {
      const out: Asked[] = [];
      for (const fact of list) {
        const started = performance.now();
        await w.useMeetHint.getState().search(fact.question);
        const ms = performance.now() - started;
        const card = w.useMeetHint.getState().card;
        out.push({
          ms,
          said: Boolean(card?.say),
          cited: Boolean(card?.citations.some((cite) => cite.path.endsWith(fact.path))),
        });
      }
      w.__asked = out;
    })();
  }, facts);
  const read = () => page.evaluate(() => (window as unknown as TestWindow).__asked);
  await expect.poll(async () => (await read()) !== null, { timeout: 120_000, intervals: [250] }).toBe(true);
  return (await read())!;
}

/** A small space, made in the page, with one file that says what it is. */
async function makeSmallSpace(page: Page, name: string): Promise<string> {
  const id = await page.evaluate(async (folder) => {
    const w = window as unknown as TestWindow;
    const file = new File([`# ${folder}\n\nThe ${folder} notes say the answer is ${folder.length}.\n`], "notes.md", { type: "text/markdown" });
    Object.defineProperty(file, "webkitRelativePath", { value: `${folder}/notes.md` });
    const result = await w.useMeetHint.getState().loadFolder([file]);
    return result.contextId;
  }, name);
  expect(id, `space ${name} was created`).toBeTruthy();
  await waitReady(page);
  return id!;
}

/** Ledger rows (files whose chunks are on record) for one space, read from the browser's database. */
async function indexedFileCount(page: Page, contextId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const names = (await indexedDB.databases()).map((db) => db.name).filter((name): name is string => Boolean(name));
    let total = 0;
    for (const name of names) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        if (!db.objectStoreNames.contains("indexedSources")) continue;
        const index = db.transaction("indexedSources", "readonly").objectStore("indexedSources").index("contextId");
        total += await new Promise<number>((resolve, reject) => {
          const request = index.count(IDBKeyRange.only(id));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    }
    return total;
  }, contextId);
}

test("a 1,500-file folder loads whole: live progress on the chip, every skipped file named, questions inside the budget", async ({ page }) => {
  const FILES = 1500;
  const repo = fixture({ files: FILES, withSkipped: true });
  await recordChip(page);
  await openCockpit(page);
  await pickFolder(page, repo);
  await waitReady(page);

  // The chip shows the real count: every file, three times the old limit.
  const chunks = await store(page, (state) => state.chunks.length);
  await expect(page.getByTestId("index-chip-text")).toHaveText(
    `Indexed ${FILES.toLocaleString("en-US")} files · 16 skipped · ${chunks.toLocaleString("en-US")} chunks`,
  );
  await expect(page.getByTestId("index-chip-phase")).toHaveText(/^Ready/);
  const stored = await store(page, (state) => state.sources.map((source) => source.path));
  expect(stored.length).toBe(FILES);
  expect(stored.length).toBeGreaterThan(OLD_FILE_LIMIT);
  // Nothing was left out for size, so nothing is announced as left out.
  expect(await store(page, (state) => state.packNotice)).toBeNull();
  await expect(page.getByTestId("pack-limit-banner")).toHaveCount(0);

  // While it loaded, the chip counted the files through each step.
  const texts = await page.evaluate(() => (window as unknown as TestWindow).__chipTexts.slice());
  const reading = counted(texts, "Reading", FILES);
  const indexing = counted(texts, "Indexing", FILES);
  test.info().annotations.push({
    type: "chip while loading",
    description: `reading ${reading.join(", ")} · indexing ${indexing.join(", ")}`,
  });
  expect(reading.length, texts.join("\n")).toBeGreaterThan(1);
  expect(indexing.length, texts.join("\n")).toBeGreaterThan(2);
  for (const steps of [reading, indexing]) {
    expect(steps, "the count only goes up").toEqual([...steps].sort((a, b) => a - b));
    expect(steps.every((done) => done >= 0 && done <= FILES)).toBe(true);
  }
  expect(indexing.some((done) => done > 0 && done < FILES), "a count part of the way through").toBe(true);
  // Reading comes before indexing, and the count of chunks grows with the files.
  const firstIndexing = texts.findIndex((text) => text.startsWith("Indexing "));
  const lastReading = texts.map((text) => text.startsWith("Reading ")).lastIndexOf(true);
  expect(lastReading).toBeLessThan(firstIndexing);
  expect(texts.some((text) => /^Indexing [\d,]+ of 1,500 files, [\d,]+ chunks so far…$/.test(text))).toBe(true);

  // Every file that was left out is under the chip, with why.
  await page.getByTestId("index-chip").click();
  const panel = page.getByTestId("index-chip-panel");
  await expect(panel.getByTestId("index-chip-stored")).toHaveText("1,500 files stored, 1,500 files searchable.");
  const skipped = panel.getByTestId("index-chip-skipped");
  await expect(panel).toContainText("16 files skipped by a rule");
  for (const item of repo.skipped) {
    const group = skipped.locator(`li[data-reason="${item.reason}"]`);
    await expect(group, item.reason).toHaveCount(1);
    await expect(group).toContainText(`${repo.name}/${item.path}`);
  }
  const vendor = skipped.locator('li[data-reason="vendor and build folders"]');
  await expect(vendor).toContainText("12 × vendor and build folders");
  await expect(vendor.locator("ul > li")).toHaveText([`${repo.name}/node_modules/ (12 files)`]);
  // 16 files in 5 entries: no entry stands for a file it does not name or count.
  const listed = await store(page, (state) => state.loadSkipped?.files ?? []);
  expect(listed.reduce((sum, item) => sum + (item.count ?? 1), 0)).toBe(16);
  expect(listed.map((item) => item.path).sort()).toEqual(repo.skipped.map((item) => item.path).sort());
  await page.keyboard.press("Escape");

  // The file pane draws the rows on screen, not 1,500 of them.
  const list = page.getByTestId("file-list");
  if (await list.isVisible()) {
    await expect(list).toHaveAttribute("data-row-count", String(FILES));
    expect(await list.locator("li[data-source-path]").count()).toBeLessThan(120);
  }

  // Questions, each about a sentence one file holds.
  const asked = await askAll(page, repo.facts);
  const times = asked.map((question) => Math.round(question.ms));
  const right = asked.filter((question) => question.cited).length;
  test.info().annotations.push({
    type: "search once Ready",
    description: `${asked.length} questions, slowest ${Math.max(...times)} ms, ${right} answered from the right file · ${times.join(" ")}`,
  });
  expect(Math.max(...times), times.join(" ")).toBeLessThan(SEARCH_BUDGET_MS);
  // One fact file in every 50. The old limit kept 500 files, so at most 10 of
  // these could have been found then.
  expect(right).toBeGreaterThan(OLD_FILE_LIMIT / 50);

  // After a reload everything is read back: same count, same list, same budget.
  await page.reload();
  await waitReady(page);
  await expect(page.getByTestId("index-chip-text")).toHaveText(
    `Indexed ${FILES.toLocaleString("en-US")} files · 16 skipped · ${chunks.toLocaleString("en-US")} chunks`,
  );
  const again = await askAll(page, repo.facts.slice(0, 10));
  expect(Math.max(...again.map((question) => question.ms))).toBeLessThan(SEARCH_BUDGET_MS);
});

test("files over the limit are loaded up to it, and each one left out is listed with the limit it ran into", async ({ page }) => {
  const FILES = 700;
  const LIMIT = 600;
  const repo = fixture({ files: FILES });
  // Limits a browser test may set; read only by a build made for these tests.
  await page.addInitScript((maxFiles) => {
    (window as unknown as TestWindow).__folderLimits = { maxFiles };
  }, LIMIT);
  await openCockpit(page);
  await page.getByTestId("folder-input").first().setInputFiles(repo.folder);
  const dialog = page.getByTestId("review-pack-dialog");
  await expect(dialog).toBeVisible({ timeout: 120_000 });
  // The review says how many are over, and over what, before anything is indexed.
  await expect(dialog).toContainText("100 files are over the limit for one selection (600 files or 50 MB)");
  await page.getByTestId("review-pack-index").click();
  await waitReady(page);

  const chunks = await store(page, (state) => state.chunks.length);
  await expect(page.getByTestId("index-chip-text")).toHaveText(
    `Indexed 600 files · 100 skipped · ${chunks.toLocaleString("en-US")} chunks`,
  );
  await expect(page.getByTestId("pack-limit-banner")).toContainText(
    "Loaded 600 files. 100 more are over the limit for one selection (600 files or 50 MB) and are listed under the index chip.",
  );

  const kept = new Set(await store(page, (state) => state.sources.map((source) => source.path)));
  const left = await store(page, (state) => state.loadSkipped?.files ?? []);
  expect(left.length).toBe(100);
  expect(left.every((item) => item.reason === "over the 600-file limit" && !item.count)).toBe(true);
  // A file is stored or it is listed: never both, never neither.
  expect(left.filter((item) => kept.has(`${repo.name}/${item.path}`))).toEqual([]);
  expect(kept.size + left.length).toBe(FILES);

  const expectAllListed = async () => {
    await page.getByTestId("index-chip").click();
    const group = page.getByTestId("index-chip-panel").locator('li[data-reason="over the 600-file limit"]');
    await expect(group).toContainText("100 × over the 600-file limit");
    // A long list starts short and opens in place.
    await expect(group.locator("ul > li")).toHaveCount(40);
    await group.getByTestId("skipped-show-all").click();
    await expect(group.locator("ul > li")).toHaveCount(100);
    const shown = new Set((await group.locator("ul > li").allTextContents()).map((text) => text.trim()));
    expect(left.filter((item) => !shown.has(`${repo.name}/${item.path}`))).toEqual([]);
    await page.keyboard.press("Escape");
  };
  await expectAllListed();

  // The list is kept with the space: it is all still there after a reload.
  await page.reload();
  await waitReady(page);
  await expect(page.getByTestId("index-chip-text")).toHaveText(
    `Indexed 600 files · 100 skipped · ${chunks.toLocaleString("en-US")} chunks`,
  );
  await expectAllListed();
});

test("opening another space while a large folder loads stops it cleanly, and the load picks up where it stopped", async ({ page }) => {
  const FILES = 1500;
  const repo = fixture({ files: FILES });
  await openCockpit(page);
  const first = await makeSmallSpace(page, "first-space");
  const second = await makeSmallSpace(page, "second-space");
  expect(second).not.toBe(first);
  expect(await store(page, (state) => state.activeSpaceId)).toBe(second);
  const firstChip = /^Indexed 1 file · 0 skipped · \d+ chunks?$/;

  /** Open the first space the moment the load reaches `phase` with `atLeast` files done. */
  const switchDuring = (phase: "reading" | "indexing", atLeast: number) =>
    page.evaluate(
      ({ phase, atLeast, target }) => {
        const w = window as unknown as TestWindow;
        w.__switched = null;
        const stop = w.useMeetHint.subscribe((state) => {
          const activity = state.indexActivity;
          if (!activity || activity.phase !== phase || (activity.done ?? 0) < atLeast) return;
          if ((activity.done ?? 0) >= (activity.total ?? 0)) return;
          stop();
          w.__switched = { phase, done: activity.done ?? 0, total: activity.total ?? 0, from: state.activeSpaceId };
          void state.activateSpace(target);
        });
      },
      { phase, atLeast, target: first },
    );
  const switched = () => page.evaluate(() => (window as unknown as TestWindow).__switched);
  const settledOnFirst = async () => {
    await waitReady(page);
    const state = await store(page, (s) => ({
      space: s.activeSpaceId,
      sources: s.sources.map((source) => source.path),
      loading: s.loadingFolder,
      updating: s.contextUpdating,
      activity: s.indexActivity,
      error: s.folderError,
    }));
    expect(state).toEqual({
      space: first,
      sources: ["first-space/notes.md"],
      loading: false,
      updating: false,
      activity: null,
      error: null,
    });
    await expect(page.getByTestId("index-chip-text")).toHaveText(firstChip);
  };

  // 1. While the files are still being read: nothing has been stored, so nothing is added.
  await switchDuring("reading", 300);
  await pickFolder(page, repo);
  await expect.poll(switched, { timeout: 120_000 }).not.toBeNull();
  const duringRead = (await switched())!;
  expect(duringRead.from).toBe(second);
  expect(duringRead.done).toBeLessThan(FILES);
  await settledOnFirst();
  await page.waitForTimeout(1500);
  // The stopped load does not come back and replace the space that was opened.
  await settledOnFirst();
  expect(await indexedFileCount(page, second)).toBe(1);
  await page.evaluate((id) => (window as unknown as TestWindow).useMeetHint.getState().activateSpace(id), second);
  await waitReady(page);
  expect(await store(page, (state) => state.sources.length), "the second space has only its own file").toBe(1);

  // 2. While the files are being indexed: they are stored, and part of the index is on record.
  await switchDuring("indexing", 200);
  await pickFolder(page, repo);
  await expect.poll(switched, { timeout: 180_000 }).not.toBeNull();
  const duringIndex = (await switched())!;
  expect(duringIndex.from).toBe(second);
  expect(duringIndex.total).toBe(FILES + 1);
  expect(duringIndex.done).toBeGreaterThanOrEqual(200);
  expect(duringIndex.done).toBeLessThan(FILES);
  await settledOnFirst();
  await page.waitForTimeout(1500);
  await settledOnFirst();
  // A question on the space that was opened is answered from that space.
  const asked = await askAll(page, [{ question: "What do the first-space notes say the answer is?", path: "first-space/notes.md", answer: "11" }]);
  expect(asked[0].ms).toBeLessThan(SEARCH_BUDGET_MS);
  expect(await store(page, (state) => state.card?.citations.every((cite) => cite.path.startsWith("first-space/")) ?? true)).toBe(true);

  // What the stopped pass finished is kept: at least what the chip had counted, and not all of it.
  const kept = await indexedFileCount(page, second);
  test.info().annotations.push({
    type: "stopped mid-index",
    description: `switched at ${duringIndex.done} of ${duringIndex.total} files; ${kept} files' chunks on record`,
  });
  expect(kept).toBeGreaterThanOrEqual(duringIndex.done);
  expect(kept).toBeLessThan(FILES + 1);

  // Opening the second space again finishes the job: every file, searchable.
  await page.evaluate((id) => (window as unknown as TestWindow).useMeetHint.getState().activateSpace(id), second);
  await waitReady(page);
  const chunks = await store(page, (state) => state.chunks.length);
  await expect(page.getByTestId("index-chip-text")).toHaveText(
    `Indexed 1,501 files · 0 skipped · ${chunks.toLocaleString("en-US")} chunks`,
  );
  expect(await indexedFileCount(page, second)).toBe(FILES + 1);
  const answers = await askAll(page, repo.facts.slice(0, 12));
  expect(Math.max(...answers.map((question) => question.ms))).toBeLessThan(SEARCH_BUDGET_MS);
  expect(answers.filter((question) => question.cited).length).toBeGreaterThan(6);
});

test("Stop, under the chip, ends a load that is still reading and adds nothing", async ({ page }) => {
  const FILES = 1500;
  const repo = fixture({ files: FILES });
  await openCockpit(page);
  const space = await makeSmallSpace(page, "only-space");

  // Reading 1,500 files takes under a second, so the page presses Stop itself
  // as soon as the load is part of the way through.
  await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    w.__stopped = null;
    let pressed = false;
    const stop = w.useMeetHint.subscribe((state) => {
      const activity = state.indexActivity;
      if (pressed || !activity || activity.phase !== "reading" || (activity.done ?? 0) < 100) return;
      pressed = true;
      stop();
      const done = activity.done ?? 0;
      const total = activity.total ?? 0;
      document.querySelector<HTMLElement>('[data-testid="index-chip"]')?.click();
      const press = () => {
        const button = document.querySelector<HTMLElement>('[data-testid="index-chip-stop"]');
        if (button) {
          button.click();
          w.__stopped = { done, total, button: true };
        } else if (w.useMeetHint.getState().indexActivity?.phase === "reading") {
          requestAnimationFrame(press);
        } else {
          w.__stopped = { done, total, button: false };
        }
      };
      requestAnimationFrame(press);
    });
  });
  await pickFolder(page, repo);
  const stopped = () => page.evaluate(() => (window as unknown as TestWindow).__stopped);
  await expect.poll(stopped, { timeout: 120_000 }).not.toBeNull();
  expect((await stopped())!.button, "the Stop button was there while the files were read").toBe(true);

  await waitReady(page);
  await expect(page.getByTestId("pack-limit-banner")).toHaveText(/Stopped\. Nothing was added\./);
  expect(await store(page, (state) => ({ space: state.activeSpaceId, files: state.sources.length }))).toEqual({
    space,
    files: 1,
  });
  await page.waitForTimeout(1500);
  expect(await store(page, (state) => state.sources.length)).toBe(1);
  expect(await indexedFileCount(page, space)).toBe(1);
  await expect(page.getByTestId("index-chip-text")).toHaveText(/^Indexed 1 file · 0 skipped · \d+ chunks?$/);
  // Once nothing is loading there is nothing to stop.
  await page.keyboard.press("Escape");
  await page.getByTestId("index-chip").click();
  await expect(page.getByTestId("index-chip-stop")).toHaveCount(0);
});
