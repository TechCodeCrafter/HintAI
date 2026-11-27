import { expect, test, type Locator, type Page } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import {
  fillCreateContextIdentity,
  installE2eMocks,
  mockLLM,
  openCockpit,
  typeQuestion,
  waitForCard,
  waitForIndexing,
} from "./fixtures/helpers";

/**
 * The evidence view: why a card said what it said.
 *
 * Hover, long press, click and keyboard all open the same view. These tests
 * drive it on the three surfaces a card is shown on (the cockpit, the cockpit
 * as an overlay, the second screen), for a card the offline composer wrote and
 * for one the model wrote, and check that an open view never holds up the
 * next answer.
 */

const RETRY = "Why does that retry three times?";
const BACKOFF = "What does the backoff start at?";
const SCHEDULE = "Where is the settlement export scheduled?";

type CardState = {
  query?: string;
  say?: string | null;
  flightTier?: string;
  source?: string;
  evidence?: { path?: string; text?: string; sourceText?: string }[];
};

type StoreState = {
  card: CardState | null;
  pack: { files: { path: string; content: string }[] };
  setOverlay: (on: boolean) => void;
  searchDetails: { topHits: { score: number; parts: Record<string, number> }[] } | null;
};

function state<T>(page: Page, read: (s: StoreState) => T): Promise<T> {
  return page.evaluate(
    (source) => new Function("s", `return (${source})(s)`)(window.useMeetHint!.getState()) as T,
    read.toString(),
  );
}

async function ask(page: Page, question: string): Promise<string> {
  await typeQuestion(page, question);
  await expect.poll(() => state(page, (s) => (s.card?.say ? s.card.query : "")), { timeout: 20000 }).toBe(question);
  const card = await waitForCard(page, { allowNull: false });
  return (await card.getByTestId("card-say").innerText()).trim();
}

/** Moves the mouse onto the middle of `target`, as a person resting on it would. */
async function rest(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/** A finger held on `target` for `ms`, then lifted. */
async function hold(target: Locator, ms: number) {
  const box = (await target.boundingBox())!;
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  const finger = { pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true, ...at };
  await target.dispatchEvent("pointerdown", finger);
  await target.page().waitForTimeout(ms);
  await target.dispatchEvent("pointerup", finger);
}

const openState = (card: Locator) => card.getAttribute("data-evidence-open");

/** The marked runs of the open view: `exact` are word for word, `words` are single words. */
async function marks(view: Locator) {
  return view.getByTestId("card-why-mark").evaluateAll((nodes) => ({
    exact: nodes.filter((n) => n.getAttribute("data-exact") === "true").map((n) => n.textContent ?? ""),
    words: nodes.filter((n) => n.getAttribute("data-exact") !== "true").map((n) => n.textContent ?? ""),
  }));
}

/** Every marked run is in the spoken line, and every passage is text the card cites. */
async function expectHonest(view: Locator, say: string, cited: string[]) {
  const passages = await view.getByTestId("card-why-text").allInnerTexts();
  expect(passages.length).toBeGreaterThan(0);
  for (const passage of passages) {
    expect(cited.some((text) => text.includes(passage.trim())), `not cited text: ${passage}`).toBe(true);
  }
  const found = await marks(view);
  expect(found.exact.length, "no exact span marked").toBeGreaterThan(0);
  const spoken = say.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  for (const mark of [...found.exact, ...found.words]) {
    expect(spoken, `marked but not said: ${mark}`).toContain(mark.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  }
  return found;
}

test("cockpit: hover shows a local card's passages with exact spans, the keyboard keeps them open, Escape closes", async ({ page }) => {
  await openCockpit(page);
  const say = await ask(page, RETRY);
  expect(await state(page, (s) => s.card?.flightTier)).toBe("localCard");

  const card = page.getByTestId("card").locator("[data-evidence-card]");
  const view = card.getByTestId("card-why");
  expect(await openState(card)).toBe("closed");
  await expect(view.getByTestId("card-why-text")).toHaveCount(0);

  // Hover: the pointer rests on the answer and the view opens on its own.
  await rest(page, card.getByTestId("card-say"));
  await expect(card).toHaveAttribute("data-evidence-open", "hover");
  await expect(view).toHaveAttribute("data-opened-by", "hover");
  await expect(view.getByTestId("card-why-span")).toHaveCount(1);
  await expect(view.getByTestId("card-why-where")).toContainText("src/exporter/retry.ts");
  const file = await state(page, (s) => s.pack.files.find((f) => f.path === "src/exporter/retry.ts")!.content);
  const found = await expectHonest(view, say, [file]);
  // The sentence spans three comment lines: three exact runs, and no comment marker inside any.
  expect(found.exact).toHaveLength(3);
  expect(found.exact.join(" ")).not.toContain("*");

  // The pointer leaves and it closes again.
  await page.mouse.move(2, 2);
  await expect(card).toHaveAttribute("data-evidence-open", "closed");
  await expect(view.getByTestId("card-why-text")).toHaveCount(0);

  // The keyboard opens it to stay.
  await view.getByTestId("card-why-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("data-evidence-open", "pinned");
  await page.mouse.move(2, 2);
  await page.waitForTimeout(500);
  await expect(view.getByTestId("card-why-text")).toBeVisible();

  await expectHonest(view, say, [file]);
  // What is remembered for the tab is a name for the answer, not its text.
  const kept = await page.evaluate(() => sessionStorage.getItem("meethint.evidenceOpen"));
  expect(kept).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);

  // A click on the control closes it, and the pointer still on the card does not reopen it.
  const toggle = view.getByTestId("card-why-toggle");
  await toggle.click();
  await expect(card).toHaveAttribute("data-evidence-open", "closed");
  const box = (await toggle.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 4);
  await page.mouse.move(box.x + 10, box.y + 6);
  await page.waitForTimeout(500);
  expect(await openState(card)).toBe("closed");
  expect(await page.evaluate(() => sessionStorage.getItem("meethint.evidenceOpen"))).toBeNull();

  // Once the pointer has left and come back, hover works again, and Escape closes that too.
  await page.mouse.move(2, 2);
  await rest(page, card.getByTestId("card-say"));
  await expect(card).toHaveAttribute("data-evidence-open", "hover");
  await toggle.focus();
  await page.keyboard.press("Escape");
  await expect(card).toHaveAttribute("data-evidence-open", "closed");
});

test("cockpit: a model-written card opens to its cited passages, offline and with no request", async ({ page, context }) => {
  test.setTimeout(120_000);
  await installE2eMocks(page);
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await fillCreateContextIdentity(page, `evidence-${Date.now()}`);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("upload-files-button").click()]);
  const AUTH =
    "/**\n * Checkout requires a signed token on every request.\n * Tokens are rotated every thirty days by the platform team.\n */\nexport const TOKEN_TTL_DAYS = 30;\n";
  const BILLING = "/**\n * Sessions expire after forty minutes of idle time.\n */\nexport const IDLE_MINUTES = 40;\n";
  await chooser.setFiles([
    { name: "auth.ts", mimeType: "text/plain", buffer: Buffer.from(AUTH) },
    { name: "billing.ts", mimeType: "text/plain", buffer: Buffer.from(BILLING) },
  ]);
  await waitForIndexing(page);
  await page.getByTestId("indexing-done").click();
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", { timeout: 30000 });

  // The composer has no sentence for this question, so the model answers it.
  await mockLLM(
    page,
    "Checkout requires a signed token on every request, and sessions expire after forty minutes of idle time. [1][2]",
  );
  const say = await ask(page, "How do checkout requests and idle sessions get secured?");
  expect(await state(page, (s) => s.card?.flightTier)).toBe("grounded");
  expect(await state(page, (s) => s.card?.source)).not.toBe("local");

  // The network goes, and every request from here on is counted.
  await page.waitForTimeout(1000);
  await context.setOffline(true);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  const card = page.getByTestId("card").locator("[data-evidence-card]");
  const view = card.getByTestId("card-why");
  await rest(page, card.getByTestId("card-say"));
  await expect(card).toHaveAttribute("data-evidence-open", "hover");
  await expect(view.getByTestId("card-why-span")).toHaveCount(2);
  await view.getByTestId("card-why-toggle").click();
  await expect(card).toHaveAttribute("data-evidence-open", "pinned");

  const found = await expectHonest(view, say, [AUTH, BILLING]);
  // One exact span per cited file: the two halves of the model's sentence.
  expect(found.exact.map((mark) => mark.toLowerCase()).sort()).toEqual([
    "checkout requires a signed token on every request",
    "sessions expire after forty minutes of idle time",
  ]);
  await expect(view.getByTestId("card-why-where")).toHaveText([/billing\.ts:2$/, /auth\.ts:2$/]);

  await page.waitForTimeout(500);
  expect(requests, "opening the evidence view made a request").toEqual([]);
  await context.setOffline(false);
});

test("overlay: hover and a held finger open it, and an open view never holds up the next answer", async ({ page }) => {
  await openCockpit(page);
  await state(page, (s) => s.setOverlay(true));
  await expect(page.locator("main.cockpit-workspace")).toHaveAttribute("data-mode", "overlay");

  const first = await ask(page, RETRY);
  const card = page.getByTestId("card").locator("[data-evidence-card]");
  const view = card.getByTestId("card-why");
  const files = await state(page, (s) => s.pack.files.map((f) => f.content));

  // Hover, in the overlay.
  await rest(page, card.getByTestId("card-say"));
  await expect(card).toHaveAttribute("data-evidence-open", "hover");
  await expectHonest(view, first, files);
  await page.mouse.move(2, 2);
  await expect(card).toHaveAttribute("data-evidence-open", "closed");

  // A short tap is not a long press.
  await hold(card.getByTestId("card-say"), 150);
  await page.waitForTimeout(500);
  expect(await openState(card)).toBe("closed");
  // A held finger opens it to stay: there is no pointer to leave on a touch screen.
  await hold(card.getByTestId("card-say"), 700);
  await expect(card).toHaveAttribute("data-evidence-open", "pinned");
  await expectHonest(view, first, files);

  // With the view open and the pointer resting on the card, the next question
  // is answered: the new line is on screen and its view is closed.
  await rest(page, card.getByTestId("card-say"));
  await page.evaluate(() => {
    const seen: Record<string, number> = {};
    (window as unknown as { __said: Record<string, number> }).__said = seen;
    const note = () => {
      const say = document.querySelector('[data-testid="card"] [data-testid="card-say"]')?.textContent ?? "";
      if (say && seen[say] === undefined) seen[say] = performance.now();
    };
    new MutationObserver(note).observe(document.body, { childList: true, subtree: true, characterData: true });
    const store = window.useMeetHint as unknown as {
      subscribe: (fn: (s: { card: { say?: string | null } | null }) => void) => void;
    };
    const ready: Record<string, number> = {};
    (window as unknown as { __ready: Record<string, number> }).__ready = ready;
    store.subscribe((s) => {
      const say = s.card?.say;
      if (say && ready[say] === undefined) ready[say] = performance.now();
    });
  });
  const second = await ask(page, BACKOFF);
  expect(second).not.toBe(first);
  await expect(card.getByTestId("card-say")).toHaveText(second);
  expect(await openState(card)).toBe("closed");
  const lag = await page.evaluate(
    (say) => {
      const w = window as unknown as { __said: Record<string, number>; __ready: Record<string, number> };
      return w.__said[say]! - w.__ready[say]!;
    },
    second,
  );
  console.log(`overlay: answer ready to on screen, with the previous evidence view open: ${lag.toFixed(1)} ms`);
  expect(lag).toBeLessThan(200);
  // The page changed under a pointer that did not move: that opens nothing.
  await page.waitForTimeout(600);
  expect(await openState(card)).toBe("closed");
  // The new card's own evidence opens when asked for.
  await view.getByTestId("card-why-toggle").click();
  await expect(card).toHaveAttribute("data-evidence-open", "pinned");
  await expectHonest(view, second, files);
});

test("second screen: hover, long press, a reload and the next answer", async ({ page, context }) => {
  await openCockpit(page);
  const relay = await context.newPage();
  await relay.goto("/relay");
  const first = await ask(page, RETRY);
  await expect(relay.getByTestId("relay-say")).toHaveText(first);
  const cited = async () =>
    (await state(page, (s) => (s.card?.evidence ?? []).map((item) => item.text ?? item.sourceText ?? ""))) as string[];

  const card = relay.getByTestId("relay-card");
  const view = card.getByTestId("card-why");
  expect(await openState(card)).toBe("closed");

  // Hover on the second screen.
  await rest(relay, relay.getByTestId("relay-say"));
  await expect(card).toHaveAttribute("data-evidence-open", "hover");
  await expectHonest(view, first, await cited());
  await relay.mouse.move(2, 2);
  await expect(card).toHaveAttribute("data-evidence-open", "closed");

  // A held finger, as on a phone.
  await hold(relay.getByTestId("relay-say"), 700);
  await expect(card).toHaveAttribute("data-evidence-open", "pinned");
  const before = await marks(view);

  // A reload: the card is read back from the wire with its evidence still open.
  await relay.reload();
  await expect(relay.getByTestId("relay-say")).toHaveText(first);
  await expect(card).toHaveAttribute("data-evidence-open", "pinned");
  await expectHonest(view, first, await cited());
  expect(await marks(view)).toEqual(before);

  // The next answer arrives while the view is open, inside the second screen's budget.
  await page.evaluate(() => {
    const ready: Record<string, number> = {};
    (window as unknown as { __ready: Record<string, number> }).__ready = ready;
    const store = window.useMeetHint as unknown as {
      subscribe: (fn: (s: { card: { say?: string | null } | null }) => void) => void;
    };
    store.subscribe((s) => {
      const say = s.card?.say;
      if (say && ready[say] === undefined) ready[say] = Date.now();
    });
  });
  await relay.evaluate(() => {
    const shown: Record<string, number> = {};
    (window as unknown as { __shown: Record<string, number> }).__shown = shown;
    const read = () => {
      const say = document.querySelector('[data-testid="relay-say"]')?.textContent ?? "";
      if (say && shown[say] === undefined) shown[say] = Date.now();
    };
    new MutationObserver(read).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const second = await ask(page, SCHEDULE);
  expect(second).not.toBe(first);
  await expect(relay.getByTestId("relay-say")).toHaveText(second, { timeout: 5000 });
  const lag =
    (await relay.evaluate((say) => (window as unknown as { __shown: Record<string, number> }).__shown[say]!, second)) -
    (await page.evaluate((say) => (window as unknown as { __ready: Record<string, number> }).__ready[say]!, second));
  console.log(`second screen: answer ready to on screen, with the previous evidence view open: ${lag} ms`);
  expect(lag).toBeLessThanOrEqual(800);
  expect(await openState(card)).toBe("closed");

  // Offline, the new card's evidence opens from what the card carries.
  await context.setOffline(true);
  await view.getByTestId("card-why-toggle").click();
  await expect(card).toHaveAttribute("data-evidence-open", "pinned");
  await expectHonest(view, second, await cited());
  await context.setOffline(false);
});

test("search details show each top hit's score as lexical, semantic, structural and symbol, in the overlay too", async ({ page }) => {
  await openCockpit(page);
  // Off: no breakdown anywhere.
  await typeQuestion(page, RETRY);
  await waitForCard(page, { badge: "From your files" });
  await expect(page.getByTestId("search-details-breakdown")).toHaveCount(0);

  await page.getByTestId("search-details-toggle").click();
  // A question that writes a symbol out, so the symbol part is not zero.
  await typeQuestion(page, "What does withRetry do?");
  const panel = page.getByTestId("search-details");
  await expect(panel.getByTestId("search-details-query")).toContainText("withRetry");

  const check = async () => {
    const hits = (await state(page, (s) => s.searchDetails?.topHits ?? [])) as {
      score: number;
      parts: Record<string, number>;
    }[];
    expect(hits.length).toBeGreaterThan(0);
    const rows = panel.getByTestId("search-details-hit");
    await expect(rows).toHaveCount(hits.length);
    for (const [index, hit] of hits.entries()) {
      const row = rows.nth(index);
      await expect(row.getByTestId("search-details-breakdown")).toBeVisible();
      // The four parts, in order, each with the number the record holds.
      await expect(row.getByTestId("search-details-part")).toHaveText(
        ["lexical", "semantic", "structural", "symbol"].map((part) => `${part}${hit.parts[part]!.toFixed(2)}`),
      );
      const sum = Object.values(hit.parts).reduce((total, value) => total + value, 0);
      expect(Math.abs(sum - hit.score), `parts ${JSON.stringify(hit.parts)} vs ${hit.score}`).toBeLessThanOrEqual(0.02);
    }
    return hits;
  };
  const hits = await check();
  expect(hits[0]!.parts.symbol).toBeGreaterThan(0);
  await expect(panel.getByTestId("search-details-hit").first().locator('[data-part="symbol"]')).not.toHaveAttribute(
    "data-zero",
    "true",
  );

  await state(page, (s) => s.setOverlay(true));
  await expect(page.locator("main.cockpit-workspace")).toHaveAttribute("data-mode", "overlay");
  await check();
});
