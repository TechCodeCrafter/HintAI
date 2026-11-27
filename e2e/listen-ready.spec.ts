import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { fillControlledInput, fillCreateContextIdentity, installE2eMocks } from "./fixtures/helpers";

/**
 * Listen means the system is prepared.
 *
 * Listen is off until the index chip reports Ready. A first question asked
 * while the vectors are not in memory is answered from word search and says
 * so. Files added during a session are indexed behind it.
 */
test.setTimeout(240_000);

// A microphone, so that Listen starts a real session: a media stream and the
// hearing loop, not a flag set in the store.
test.use({
  permissions: ["clipboard-read", "clipboard-write", "microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  },
});

/** The budget for the first question after Ready, in milliseconds. */
const FIRST_ANSWER_MS = 1200;

type CardView = {
  say?: string;
  reason?: string;
  silence?: string;
  lexicalOnly?: boolean;
  latencyMs: number;
  citations: Array<{ path: string }>;
};
type StoreView = {
  chunks: unknown[];
  armed: boolean;
  asrNote: string;
  searching: boolean;
  contextStatus: string;
  contextUpdating: boolean;
  card: CardView | null;
  warm: { words: { ready: boolean }; vectors: { state: string; have: number; total: number } };
  setOverlay: (value: boolean) => void;
};
type TestWindow = {
  useMeetHint: { getState: () => StoreView; subscribe: (fn: (state: StoreView, previous: StoreView) => void) => () => void };
  __listenSamples: string[];
  __embedCalls: number;
  __holdEmbed: (what: string) => void;
  __releaseEmbed: () => void;
  __sessionMarks: string[];
  __asked: { ms: number; updating: boolean; card: CardView } | null;
  __attempt: { text: string; disabled: boolean; armed: boolean; note: string } | null;
};

function store<T>(page: Page, read: (state: StoreView) => T): Promise<T> {
  return page.evaluate(
    (source) => new Function("state", `return (${source})(state)`)((window as unknown as TestWindow).useMeetHint.getState()) as T,
    read.toString(),
  );
}

const WORDS = [
  "ledger", "invoice", "payout", "refund", "merchant", "settlement", "gateway", "webhook", "throttle", "quota",
  "tenant", "shard", "replica", "snapshot", "cursor", "digest", "voucher", "tariff", "carrier", "manifest",
  "parcel", "depot", "courier", "beacon", "sensor", "firmware", "telemetry", "cohort", "funnel", "segment",
  "locale", "glossary", "template", "render", "palette", "viewport", "session", "token", "scope", "audit",
];
const word = (n: number) => WORDS[n % WORDS.length];

/** Folders this run wrote, removed after each test. */
const written: string[] = [];
test.afterEach(() => {
  for (const folder of written.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const MODULES = 360;
const DOCS = 90;
/** Every module and document, and the runbook with the planted fact. */
const FILES = MODULES + DOCS + 1;

/**
 * A folder the size of a small service: 360 modules and 90 documents. One
 * fact is planted for the first question.
 */
function mediumRepo(): string {
  const folder = join(tmpdir(), `hint-medium-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  written.push(folder);
  for (let m = 0; m < MODULES; m += 1) {
    const dir = join(folder, "src", word(m * 7), word(m * 3 + 1));
    mkdirSync(dir, { recursive: true });
    const body: string[] = [`import { ${word(m + 2)}Client } from "../${word(m + 2)}";`, ""];
    for (let f = 0; f < 12; f += 1) {
      const a = word(m + f * 5);
      const b = word(m * 2 + f + 3);
      const c = word(m + f * 11 + 7);
      body.push(
        "/**",
        ` * Reconciles the ${a} ${b} for module ${m} before the ${c} window closes.`,
        ` * The ${b} is read once and cached for ${(m + f) % 50} minutes.`,
        " */",
        `export async function ${a}${b[0].toUpperCase()}${b.slice(1)}${m}x${f}(input: ${c}Input): Promise<${c}Result> {`,
        `  const ${a} = await ${word(m + 2)}Client.load(input.${b}Id);`,
        `  if (!${a}) throw new Error("missing ${a} for ${b} ${m}-${f}");`,
        `  const ${c} = ${a}.items.filter((item) => item.${b} > ${f * 10 + (m % 9)});`,
        `  for (const item of ${c}) {`,
        `    await item.apply({ ${a}: input.${a}, mode: "${b}-${c}" });`,
        "  }",
        `  return { ${c}, count: ${c}.length, module: ${m} };`,
        "}",
        "",
      );
    }
    writeFileSync(join(dir, `${word(m + 9)}-${m}.ts`), body.join("\n"));
  }
  mkdirSync(join(folder, "docs"), { recursive: true });
  for (let d = 0; d < DOCS; d += 1) {
    const sections: string[] = [`# ${word(d)} ${word(d + 13)} guide ${d}`, ""];
    for (let s = 0; s < 6; s += 1) {
      const a = word(d * 3 + s);
      const b = word(d + s * 7 + 2);
      sections.push(
        `## ${a} and ${b} (${d}.${s})`,
        "",
        `The ${a} service owns the ${b} table. Writes to the ${b} go through the ${word(d + s + 5)} queue,`,
        `and a ${a} that falls behind by ${s + 2} minutes raises alert ${d * 10 + s}.`,
        `Owners review the ${word(d + s + 9)} dashboard every ${(d % 5) + 1} days.`,
        "",
      );
    }
    writeFileSync(join(folder, "docs", `${word(d)}-${d}.md`), sections.join("\n"));
  }
  writeFileSync(
    join(folder, "docs", "export-runbook.md"),
    "# Nightly export runbook\n\nThe nightly export job retries three times before it pages the on-call engineer.\n",
  );
  return folder;
}

/**
 * Before any page script: a recorder for the chip and the Listen button, and
 * an embedder that can be held, to stand in for vectors that are still loading.
 */
async function installProbes(page: Page) {
  await installE2eMocks(page);
  await page.addInitScript(() => {
    const w = window as unknown as TestWindow & { __mockEmbedder: (text: string) => Promise<number[]> };
    const samples: string[] = [];
    w.__listenSamples = samples;
    const sample = () => {
      const chip = document.querySelector<HTMLElement>('[data-testid="index-chip"]');
      const listen = document.querySelector<HTMLButtonElement>('[data-testid="listen-button"]');
      if (!chip || !listen) return;
      const entry = [
        chip.dataset.phase,
        chip.dataset.ready === "true" ? "ready" : "not-ready",
        listen.disabled ? "listen-off" : "listen-on",
        listen.getAttribute("aria-label"),
      ].join("|");
      if (samples.at(-1) !== entry) samples.push(entry);
    };
    new MutationObserver(sample).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

    let hold = localStorage.getItem("e2e.holdEmbed");
    let waiting: Array<() => void> = [];
    w.__embedCalls = 0;
    w.__holdEmbed = (what) => {
      hold = what;
    };
    w.__releaseEmbed = () => {
      hold = null;
      localStorage.removeItem("e2e.holdEmbed");
      for (const go of waiting) go();
      waiting = [];
    };
    w.__mockEmbedder = async (text: string) => {
      w.__embedCalls += 1;
      if (hold === "all" || (hold && text.includes(hold))) await new Promise<void>((resolve) => waiting.push(resolve));
      const vec = new Array(384).fill(0);
      for (let i = 0; i < text.length; i += 1) vec[i % 384] = (text.charCodeAt(i) % 100) / 100;
      return vec;
    };
  });
}

/** Create a space from the medium folder and land in its cockpit. */
async function openMediumSpace(page: Page, name: string) {
  await installProbes(page);
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await fillCreateContextIdentity(page, `${name}-${Date.now()}`);
  await page.getByTestId("folder-input").setInputFiles(mediumRepo());
  await expect(page.getByTestId("review-pack-dialog")).toBeVisible({ timeout: 60000 });
  await page.getByTestId("review-pack-index").click();
  await page.getByTestId("indexing-complete").waitFor({ timeout: 150000 });
  await page.getByTestId("indexing-done").click();
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", { timeout: 60000 });
  await expect(page.getByTestId("index-chip")).toHaveAttribute("data-ready", "true", { timeout: 60000 });
}

type Asked = { ms: number; updating: boolean; card: CardView };

/**
 * Ask through the search box, and time it in the page: from the Enter key to
 * the moment the answer (or the silence) is on the card.
 *
 * The page records the result and the test reads it afterwards. Nothing here
 * leaves a call waiting on the page while the search runs.
 */
async function ask(page: Page, text: string): Promise<Asked> {
  const input = page.getByTestId("search-input");
  await fillControlledInput(input, text);
  await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    w.__asked = null;
    let started = 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      started = performance.now();
      window.removeEventListener("keydown", onKey, true);
    };
    window.addEventListener("keydown", onKey, true);
    const stop = w.useMeetHint.subscribe((state, previous) => {
      if (!started || !previous.searching || state.searching || !state.card) return;
      stop();
      w.__asked = { ms: performance.now() - started, updating: state.contextUpdating, card: state.card };
    });
  });
  await input.press("Enter");
  const asked = () => page.evaluate(() => (window as unknown as TestWindow).__asked);
  await expect.poll(async () => (await asked()) !== null, { timeout: 30000 }).toBe(true);
  return (await asked())!;
}

/** What a question came back with, for the report. */
function outcome(result: { ms: number; card: CardView }): string {
  const what = result.card.say
    ? `card citing ${[...new Set(result.card.citations.map((cite) => cite.path.split("/").at(-1)))].join(", ")}`
    : `silence (${result.card.silence ?? "no kind"}): ${result.card.reason}`;
  return `${Math.round(result.ms)} ms in the page, ${result.card.latencyMs} ms on the card, ${what}${result.card.lexicalOnly ? ", word search only" : ""}`;
}

const samples = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__listenSamples.slice());

test("Listen is off until the chip reports Ready, and the first question after Ready is answered inside the budget", async ({ page }) => {
  await openMediumSpace(page, "listen-ready");
  const chip = page.getByTestId("index-chip");
  const listen = page.getByTestId("listen-button");
  const chunks = await store(page, (state) => state.chunks.length);
  expect(chunks, "a medium repo").toBeGreaterThan(2000);

  // Open the space again from cold: nothing is in memory.
  await page.reload();
  await expect(chip).toHaveAttribute("data-ready", "true", { timeout: 90000 });
  await expect(listen).toBeEnabled();
  await expect(listen).toHaveAttribute("data-listen-ready", "true");
  await expect(page.getByTestId("index-chip-phase")).toHaveText("Ready");
  await expect(page.getByTestId("index-chip-text")).toHaveText(
    new RegExp(`^Indexed ${FILES} files · 0 skipped · ${chunks.toLocaleString("en-US")} chunks$`),
  );

  const seen = await samples(page);
  const before = seen.slice(0, seen.findIndex((entry) => entry.includes("|ready|")));
  // The chip went through its phases, and Listen was off for every one of them.
  expect(before.length, seen.join("\n")).toBeGreaterThan(0);
  expect(before.every((entry) => entry.endsWith("|not-ready|listen-off|Listen")), seen.join("\n")).toBe(true);
  // Listen was never on while the chip said anything other than Ready, in either direction.
  expect(seen.filter((entry) => entry.includes("|not-ready|listen-on|"))).toEqual([]);
  expect(seen.filter((entry) => entry.includes("|ready|listen-off|"))).toEqual([]);
  expect(seen.at(-1)).toBe("ready|ready|listen-on|Listen");
  const phases = seen.map((entry) => entry.split("|")[0]).filter((phase, i, all) => phase !== all[i - 1]);
  const order = ["loading", "reading", "indexing", "warming", "ready"];
  expect(phases.every((phase) => order.includes(phase)), phases.join(" → ")).toBe(true);
  expect(phases.map((phase) => order.indexOf(phase)), phases.join(" → ")).toEqual(
    [...phases.map((phase) => order.indexOf(phase))].sort((a, b) => a - b),
  );
  expect(phases.length, phases.join(" → ")).toBeGreaterThan(1);
  test.info().annotations.push({ type: "chip phases on a cold open", description: phases.join(" → ") });

  // The first question after Ready.
  const first = await ask(page, "How many times does the nightly export job retry?");
  test.info().annotations.push({
    type: "first question",
    description: `${outcome(first)}; ${FILES} files, ${chunks} chunks`,
  });
  expect(first.ms).toBeLessThan(FIRST_ANSWER_MS);
  expect(first.card.latencyMs).toBeLessThan(FIRST_ANSWER_MS);
  // A card, or a silence that says why.
  expect(Boolean(first.card.say) || Boolean(first.card.reason)).toBe(true);
  if (first.card.say) {
    expect(first.card.citations.map((cite) => cite.path).join(" ")).toContain("export-runbook.md");
    await expect(page.getByTestId("card-say")).toBeVisible();
  } else {
    await expect(page.getByTestId("silence-reason")).toBeVisible();
  }
  // The vectors were in memory, so this was a hybrid answer and is not marked.
  expect(first.card.lexicalOnly).toBeFalsy();
  await expect(page.getByTestId("lexical-only-note")).toHaveCount(0);

  // The chip is there in overlay mode, and on a phone.
  await store(page, (state) => state.setOverlay(true));
  await expect(page.locator("main.cockpit-workspace")).toHaveAttribute("data-mode", "overlay");
  await expect(chip).toBeVisible();
  await expect(page.getByTestId("index-chip-phase")).toHaveText("Ready");
  await store(page, (state) => state.setOverlay(false));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chip).toBeVisible();
  await expect(page.getByTestId("index-chip-phase")).toHaveText("Ready");
  await expect(listen).toBeVisible();
  await expect(listen).toBeEnabled();
  const box = await chip.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
});

test("vectors that are not ready: the first question is answered from word search and marked, the next one is hybrid", async ({ page }) => {
  await openMediumSpace(page, "listen-lexical");
  const chip = page.getByTestId("index-chip");
  const phase = page.getByTestId("index-chip-phase");
  const listen = page.getByTestId("listen-button");

  // Open the space again with the embedding model not answering.
  await page.evaluate(() => localStorage.setItem("e2e.holdEmbed", "all"));
  await page.reload();

  // While the vectors warm the chip says so, and neither the button nor the
  // L key starts a session.
  await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    w.__attempt = null;
    const look = () => {
      const node = document.querySelector<HTMLElement>('[data-testid="index-chip"]');
      const button = document.querySelector<HTMLButtonElement>('[data-testid="listen-button"]');
      if (node?.dataset.phase !== "warming" || !button) return void requestAnimationFrame(look);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
      const state = w.useMeetHint.getState();
      w.__attempt = { text: node.textContent ?? "", disabled: button.disabled, armed: state.armed, note: state.asrNote };
    };
    look();
  });
  const attempted = () => page.evaluate(() => (window as unknown as TestWindow).__attempt);
  await expect.poll(async () => (await attempted()) !== null, { timeout: 60000 }).toBe(true);
  const attempt = (await attempted())!;
  expect(attempt.text).toMatch(/Warming vectors, [\d,]+ of [\d,]+ chunks…/);
  expect(attempt.disabled).toBe(true);
  expect(attempt.armed).toBe(false);
  expect(attempt.note).toMatch(/Warming vectors/);

  // It does not wait for ever: Ready, on word search.
  await expect(phase).toHaveText("Ready · word search", { timeout: 60000 });
  await expect(chip).toHaveAttribute("data-ready", "true");
  await expect(listen).toBeEnabled();
  const seen = await samples(page);
  expect(seen.filter((entry) => entry.includes("|not-ready|listen-on|"))).toEqual([]);
  expect(seen.some((entry) => entry.startsWith("warming|not-ready|listen-off"))).toBe(true);
  await chip.click();
  await expect(page.getByTestId("index-chip-readiness")).toContainText("Answers use word search until they finish.");
  await page.keyboard.press("Escape");

  // The first question: answered at once, without the model, and marked.
  const callsBefore = await page.evaluate(() => (window as unknown as TestWindow).__embedCalls);
  const first = await ask(page, "How many times does the nightly export job retry?");
  test.info().annotations.push({
    type: "first question, word search only",
    description: outcome(first),
  });
  expect(first.ms).toBeLessThan(FIRST_ANSWER_MS);
  expect(first.card.lexicalOnly).toBe(true);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__embedCalls)).toBe(callsBefore);
  const note = page.getByTestId("card").getByTestId("lexical-only-note");
  await expect(note).toBeVisible();
  await expect(note).toHaveText("Word search only");
  expect(Boolean(first.card.say) || Boolean(first.card.reason)).toBe(true);
  // Word search found the same passage: the answer is cited as any other is.
  if (first.card.say) expect(first.card.citations.map((cite) => cite.path).join(" ")).toContain("export-runbook.md");

  // The model comes back. Nothing is clicked: the chip turns to Ready.
  await page.evaluate(() => (window as unknown as TestWindow).__releaseEmbed());
  await expect(phase).toHaveText("Ready", { timeout: 30000 });
  await expect(listen).toBeEnabled();

  const second = await ask(page, "Which queue do writes to the ledger table go through?");
  test.info().annotations.push({ type: "second question, hybrid again", description: outcome(second) });
  expect(second.card.lexicalOnly).toBeFalsy();
  await expect(page.getByTestId("lexical-only-note")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__embedCalls)).toBeGreaterThan(callsBefore);
  expect(second.ms).toBeLessThan(FIRST_ANSWER_MS);
});

test("files added while listening are indexed behind the session, which carries on", async ({ page }) => {
  // Mic only: the tab-share picker would wait for a person.
  await page.addInitScript(() => {
    if (navigator.mediaDevices?.getDisplayMedia) {
      navigator.mediaDevices.getDisplayMedia = async () => {
        throw new DOMException("Tab share skipped in e2e", "NotAllowedError");
      };
    }
  });
  await openMediumSpace(page, "listen-add");
  const cockpit = page.getByTestId("cockpit");
  const chip = page.getByTestId("index-chip");
  const phase = page.getByTestId("index-chip-phase");
  const before = await store(page, (state) => state.chunks.length);

  // A session is live.
  await page.getByTestId("listen-button").click();
  const stop = page.getByRole("button", { name: "Stop listen" });
  await expect(stop).toBeVisible({ timeout: 30000 });
  expect(await store(page, (state) => state.armed)).toBe(true);

  // Record everything the session and the index do from here on.
  await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    const marks: string[] = [];
    w.__sessionMarks = marks;
    const note = (state: StoreView) => {
      const entry = `${state.armed ? "armed" : "disarmed"}|${state.contextStatus}|${state.contextUpdating ? "updating" : "idle"}|${state.chunks.length}`;
      if (marks.at(-1) !== entry) marks.push(entry);
    };
    note(w.useMeetHint.getState());
    w.useMeetHint.subscribe(note);
    w.__listenSamples.length = 0;
    // The new file's vectors will be slow.
    w.__holdEmbed("okapi");
  });

  await page.locator("input[data-files-input]").setInputFiles([
    {
      name: "incident-runbook.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Incident runbook\n\nReplay failed jobs from the okapi queue before you restart the worker.\n"),
    },
  ]);
  await expect.poll(() => store(page, (state) => state.contextUpdating), { timeout: 30000 }).toBe(true);
  await expect(chip).toHaveAttribute("data-state", "working");

  // A question asked while the re-index runs is answered from the material in use.
  const during = await ask(page, "How many times does the nightly export job retry?");
  test.info().annotations.push({ type: "question during the re-index", description: outcome(during) });
  expect(during.updating, "the question was answered while the re-index was running").toBe(true);
  expect(Boolean(during.card.say) || Boolean(during.card.reason)).toBe(true);
  if (during.card.say) expect(during.card.citations.map((cite) => cite.path).join(" ")).toContain("export-runbook.md");
  expect(during.ms).toBeLessThan(FIRST_ANSWER_MS);

  // The new index takes over. Its vectors are still coming, so it is on word search.
  await expect.poll(() => store(page, (state) => state.chunks.length), { timeout: 60000 }).toBeGreaterThan(before);
  await expect(page.getByTestId("add-material-notice")).toHaveAttribute("data-tone", "ok", { timeout: 30000 });
  await expect(phase).toHaveText("Ready · word search", { timeout: 60000 });
  await expect(stop).toBeVisible();

  // The new file answers straight away, marked as word search.
  const added = await ask(page, "Where do I replay failed jobs from before restarting the worker?");
  test.info().annotations.push({ type: "question about the added file", description: outcome(added) });
  expect(added.card.lexicalOnly).toBe(true);
  expect(Boolean(added.card.say) || Boolean(added.card.reason)).toBe(true);
  if (added.card.say) expect(added.card.citations.map((cite) => cite.path).join(" ")).toContain("incident-runbook.md");
  expect(added.ms).toBeLessThan(FIRST_ANSWER_MS);

  await page.evaluate(() => (window as unknown as TestWindow).__releaseEmbed());
  await expect(phase).toHaveText("Ready", { timeout: 30000 });
  await expect(page.getByTestId("index-chip-text")).toHaveText(new RegExp(`^Indexed ${FILES + 1} files · 0 skipped · [\\d,]+ chunks$`));

  // From the add to the end: the session never stopped and the space never
  // went back to loading.
  const marks = await page.evaluate(() => (window as unknown as TestWindow).__sessionMarks.slice());
  test.info().annotations.push({ type: "session and index during the add", description: marks.join(" → ") });
  expect(marks.filter((entry) => entry.startsWith("disarmed")), marks.join("\n")).toEqual([]);
  expect(marks.filter((entry) => entry.split("|")[1] !== "ready"), marks.join("\n")).toEqual([]);
  expect(marks.some((entry) => entry.includes("|updating|")), marks.join("\n")).toBe(true);
  // The material in use was whole at every moment: the old index, then the new one.
  const sizes = [...new Set(marks.map((entry) => Number(entry.split("|")[3])))];
  expect(sizes, marks.join("\n")).toEqual([before, await store(page, (state) => state.chunks.length)]);
  // The button read "Stop listen" throughout, and was never off.
  const seen = await samples(page);
  expect(seen.filter((entry) => !entry.endsWith("|listen-on|Stop listen")), seen.join("\n")).toEqual([]);
  await expect(cockpit).toHaveAttribute("data-context-status", "ready");
  expect(await store(page, (state) => state.armed)).toBe(true);

  await stop.click();
  await expect(page.getByRole("button", { name: "Listen", exact: true })).toBeVisible();
});
