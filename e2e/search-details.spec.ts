import { expect, test, type Page } from "@playwright/test";
import { openCockpit, typeQuestion, waitForCard } from "./fixtures/helpers";

const RETRY = "Why does that retry three times?";
const WEATHER = "What is the weather in Tokyo today?";

type Details = {
  query: string;
  filesIndexed: number;
  chunksIndexed: number;
  stage: string;
  silence: string | null;
  topHits: { path: string; score: number; snippet: string }[];
};

function storeDetails(page: Page) {
  return page.evaluate(() => {
    const state = window.useMeetHint?.getState() as unknown as { searchDetailsOn: boolean; searchDetails: unknown };
    return { on: state.searchDetailsOn, details: state.searchDetails as Details | null };
  });
}

test("search details are off by default and nothing is built for them", async ({ page }) => {
  await openCockpit(page);

  const toggle = page.getByTestId("search-details-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("search-details")).toHaveCount(0);

  await typeQuestion(page, RETRY);
  await waitForCard(page, { badge: "From your files" });

  await expect(page.getByTestId("search-details")).toHaveCount(0);
  expect(await storeDetails(page)).toEqual({ on: false, details: null });
});

test("switched on, the next question shows the index size, the stage and the top three hits", async ({ page }) => {
  await openCockpit(page);

  const toggle = page.getByTestId("search-details-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const panel = page.getByTestId("search-details");
  await expect(panel.getByTestId("search-details-empty")).toBeVisible();

  await typeQuestion(page, RETRY);
  await waitForCard(page, { badge: "From your files" });

  const { details } = await storeDetails(page);
  expect(details?.query).toBe(RETRY);
  expect(details!.filesIndexed).toBeGreaterThan(0);
  expect(details!.chunksIndexed).toBeGreaterThanOrEqual(details!.filesIndexed);

  await expect(panel.getByTestId("search-details-query")).toContainText(RETRY);
  await expect(panel.getByTestId("search-details-index")).toHaveText(
    new RegExp(`^${details!.filesIndexed.toLocaleString("en-US")} files?, ${details!.chunksIndexed.toLocaleString("en-US")} chunks?$`),
  );
  await expect(panel.getByTestId("search-details-stage")).toHaveAttribute("data-stage", "localCard");
  await expect(panel.getByTestId("search-details-silence")).toHaveCount(0);

  const hits = panel.getByTestId("search-details-hit");
  await expect(hits).toHaveCount(details!.topHits.length);
  expect(details!.topHits.length).toBeGreaterThan(0);
  expect(details!.topHits.length).toBeLessThanOrEqual(3);
  const top = details!.topHits[0]!;
  expect(top.path).toBe("src/exporter/retry.ts");
  await expect(hits.first()).toContainText(top.path);
  await expect(hits.first()).toContainText(top.score.toFixed(2));
  expect(top.snippet.length).toBeGreaterThan(0);
  await expect(hits.first()).toContainText(top.snippet);

  // The panel sits under the answer and never takes room from it: the pane scrolls instead.
  const clipped = await page
    .getByTestId("card")
    .locator(".answer-receipt")
    .evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(clipped).toBeLessThanOrEqual(1);
});

test("a silent card shows the silence stage and its kind, in the overlay too", async ({ page }) => {
  await openCockpit(page);
  await page.getByTestId("search-details-toggle").click();

  await typeQuestion(page, WEATHER);
  const panel = page.getByTestId("search-details");
  await expect(panel.getByTestId("search-details-stage")).toHaveAttribute("data-stage", "silence");

  const kind = await page.evaluate(
    () => (window.useMeetHint?.getState() as unknown as { card: { silence?: string } | null }).card?.silence ?? null,
  );
  expect(kind).not.toBeNull();
  await expect(panel.getByTestId("search-details-silence")).toHaveText(kind!);

  await page.evaluate(() => (window.useMeetHint?.getState() as unknown as { setOverlay: (v: boolean) => void }).setOverlay(true));
  await expect(page.locator("main.cockpit-workspace")).toHaveAttribute("data-mode", "overlay");
  await expect(page.getByTestId("search-details-toggle")).toBeVisible();
  await expect(panel.getByTestId("search-details-silence")).toHaveText(kind!);
});

test("switching it off removes the panel and drops the record, and the choice survives a reload", async ({ page }) => {
  await openCockpit(page);
  const toggle = page.getByTestId("search-details-toggle");
  await toggle.click();
  await typeQuestion(page, RETRY);
  await waitForCard(page, { badge: "From your files" });
  await expect(page.getByTestId("search-details-hit").first()).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", { timeout: 20000 });
  await expect(page.getByTestId("search-details-toggle")).toHaveAttribute("aria-pressed", "true");
  // The record is memory only: a reload starts empty.
  await expect(page.getByTestId("search-details-empty")).toBeVisible();

  await typeQuestion(page, RETRY);
  await expect(page.getByTestId("search-details-hit").first()).toBeVisible();
  expect((await storeDetails(page)).details).not.toBeNull();

  await page.getByTestId("search-details-toggle").click();
  await expect(page.getByTestId("search-details")).toHaveCount(0);
  expect(await storeDetails(page)).toEqual({ on: false, details: null });
});
