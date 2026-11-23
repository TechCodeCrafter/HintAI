import { expect, test, type Page } from "@playwright/test";
import { openCockpit, typeQuestion, waitForCard } from "./fixtures/helpers";

const QUESTIONS = [
  "Why does that retry three times?",
  "What does the backoff start at?",
  "Where is the settlement export scheduled?",
];

/** When the cockpit's store first holds a spoken card for each question. */
async function watchCockpit(page: Page) {
  await page.evaluate(() => {
    const ready: Record<string, number> = {};
    (window as unknown as { __cardReady: Record<string, number> }).__cardReady = ready;
    const store = window.useMeetHint as unknown as {
      subscribe: (listener: (state: { card: { say?: string; query?: string } | null }) => void) => void;
    };
    store.subscribe((state) => {
      const card = state.card;
      if (card?.say && card.query && ready[card.say] === undefined) ready[card.say] = Date.now();
    });
  });
}

/** When the second screen's page first shows each line. */
async function watchRelay(page: Page) {
  await page.evaluate(() => {
    const shown: Record<string, number> = {};
    (window as unknown as { __shown: Record<string, number> }).__shown = shown;
    const read = () => {
      const say = document.querySelector('[data-testid="relay-say"]')?.textContent ?? "";
      if (say && shown[say] === undefined) shown[say] = Date.now();
    };
    new MutationObserver(read).observe(document.body, { childList: true, subtree: true, characterData: true });
    read();
  });
}

const readyAt = (page: Page, say: string) =>
  page.evaluate((line) => (window as unknown as { __cardReady: Record<string, number> }).__cardReady[line], say);
const shownAt = (page: Page, say: string) =>
  page.evaluate((line) => (window as unknown as { __shown: Record<string, number> }).__shown[line], say);

async function ask(page: Page, question: string): Promise<string> {
  await typeQuestion(page, question);
  const card = await waitForCard(page, { allowNull: false });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window.useMeetHint?.getState() as unknown as { card: { query?: string } | null }).card?.query ?? "",
      ),
    )
    .toBe(question);
  return (await card.getByTestId("card-say").innerText()).trim();
}

test("a card is on the second screen within 800 ms of the answer being ready, with nothing focused", async ({ page, context }) => {
  await openCockpit(page);
  const relay = await context.newPage();
  await relay.goto("/relay");
  await expect(relay.getByTestId("relay-card")).toBeVisible();
  await watchCockpit(page);
  await watchRelay(relay);

  const lags: number[] = [];
  for (const question of QUESTIONS) {
    const say = await ask(page, question);
    await expect(relay.getByTestId("relay-say")).toHaveText(say, { timeout: 5000 });
    const lag = (await shownAt(relay, say)) - (await readyAt(page, say));
    lags.push(lag);
    // The second screen's own measure, from the time stamped on the wire.
    const own = Number(await relay.getByTestId("relay-card").getAttribute("data-latency-ms"));
    expect(own, `${question}: second screen's own measure`).toBeLessThanOrEqual(800);
    expect(lag, `${question}: store to second screen`).toBeLessThanOrEqual(800);

    // The card never takes the keyboard, on either screen.
    expect(await relay.evaluate(() => document.activeElement === document.body)).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("search-input");
  }
  console.log(`second screen lag per card (ms): ${lags.join(", ")}`);
});

test("the second screen keeps its card through a reload and catches up after a network drop", async ({ page, context }) => {
  await openCockpit(page);
  const relay = await context.newPage();
  await relay.goto("/relay");

  const first = await ask(page, QUESTIONS[0]);
  await expect(relay.getByTestId("relay-say")).toHaveText(first);

  // Reload: the newest card is read back from the wire, with no cockpit action.
  await relay.reload();
  await expect(relay.getByTestId("relay-say")).toHaveText(first);
  await expect(relay.getByTestId("relay-citation").first()).toBeVisible();

  // The network drops. Both pages stay open; the answer is composed from the
  // files on this device and reaches the second screen without a request.
  await context.setOffline(true);
  const second = await ask(page, QUESTIONS[1]);
  expect(second).not.toBe(first);
  await expect(relay.getByTestId("relay-say")).toHaveText(second, { timeout: 5000 });

  // Back online, and a reload of the second screen: still the newest card.
  await context.setOffline(false);
  await relay.reload();
  await expect(relay.getByTestId("relay-say")).toHaveText(second);
  const third = await ask(page, QUESTIONS[2]);
  await expect(relay.getByTestId("relay-say")).toHaveText(third, { timeout: 5000 });
});

test("position and opacity are set once, apply on the second screen, and are remembered", async ({ page, context }) => {
  await openCockpit(page);
  const relay = await context.newPage();
  await relay.setViewportSize({ width: 1000, height: 800 });
  await relay.goto("/relay");
  const say = await ask(page, QUESTIONS[0]);
  await expect(relay.getByTestId("relay-say")).toHaveText(say);

  const dock = relay.getByTestId("relay-dock");
  const card = relay.getByTestId("relay-card");
  await expect(dock).toHaveAttribute("data-position", "top-right");
  const box = async () => {
    const [d, c] = await Promise.all([dock.boundingBox(), card.boundingBox()]);
    return { dock: d!, card: c! };
  };
  let at = await box();
  expect(at.card.x + at.card.width).toBeCloseTo(at.dock.x + at.dock.width, 0);
  expect(at.card.y).toBeCloseTo(at.dock.y, 0);

  await relay.getByTestId("overlay-position").selectOption("bottom-left");
  await expect(dock).toHaveAttribute("data-position", "bottom-left");
  at = await box();
  expect(at.card.x).toBeCloseTo(at.dock.x, 0);
  expect(at.card.y + at.card.height).toBeCloseTo(at.dock.y + at.dock.height, 0);

  await relay.getByTestId("overlay-opacity").fill("50");
  await expect(relay.getByTestId("overlay-opacity-value")).toHaveText("50%");
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).opacity)).toBe("0.5");
  // It cannot be faded out of sight.
  await expect(relay.getByTestId("overlay-opacity")).toHaveAttribute("min", "40");
  // The text is still there to read at any setting.
  await expect(relay.getByTestId("relay-say")).toHaveText(say);

  // The cockpit's overlay mode shows the same settings without a reload, and
  // fades its own workspace by the same amount.
  await page.evaluate(() =>
    (window.useMeetHint?.getState() as unknown as { setOverlay: (on: boolean) => void }).setOverlay(true),
  );
  await expect(page.getByTestId("overlay-position")).toHaveValue("bottom-left");
  await expect(page.getByTestId("overlay-opacity")).toHaveValue("50");
  await expect.poll(() => page.locator("main.cockpit-workspace").evaluate((el) => getComputedStyle(el).opacity)).toBe("0.5");
  // A reload keeps them.
  await relay.reload();
  await expect(relay.getByTestId("relay-dock")).toHaveAttribute("data-position", "bottom-left");
  await expect.poll(() => relay.getByTestId("relay-card").evaluate((el) => getComputedStyle(el).opacity)).toBe("0.5");
});

test("the second screen shows the cited passages on demand", async ({ page, context }) => {
  await openCockpit(page);
  const relay = await context.newPage();
  await relay.goto("/relay");
  const say = await ask(page, QUESTIONS[0]);
  await expect(relay.getByTestId("relay-say")).toHaveText(say);

  const why = relay.getByTestId("card-why");
  await expect(why.getByTestId("card-why-text").first()).toBeHidden();
  await why.getByTestId("card-why-toggle").click();
  await expect(why.getByTestId("card-why-text").first()).toBeVisible();
  expect(await why.getByTestId("card-why-mark").count()).toBeGreaterThan(0);
});
