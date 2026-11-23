import { expect, test, type Page } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { fillCreateContextIdentity, installE2eMocks, openCockpit, typeQuestion, waitForIndexing } from "./fixtures/helpers";

const WEATHER = "What is the weather in Tokyo today?";
// The mocked model declines, and no loaded file states this in words.
const NOT_STATED = "Do we store card numbers in the export?";

type SilentCard = {
  say: null;
  reason: string;
  silence: string;
  citations: [];
  considered?: { kind: "file"; path: string; startLine: number; endLine: number }[];
  query: string;
  latencyMs: number;
  source: "local";
};

/** Puts a Card on screen as the store would, for kinds a typed question cannot reach here. */
async function showCard(page: Page, card: Record<string, unknown>) {
  await page.evaluate((next) => {
    (window.useMeetHint as unknown as { setState: (patch: unknown) => void }).setState({ card: next });
  }, card);
}

function silentCard(silence: string, reason: string, extra: Partial<SilentCard> = {}): SilentCard {
  return { say: null, reason, silence, citations: [], query: "A question", latencyMs: 12, source: "local", ...extra };
}

test("no match: the reason says what to do, and opens to what was searched", async ({ page }) => {
  await openCockpit(page);
  await typeQuestion(page, WEATHER);

  const reason = page.getByTestId("silence-reason");
  await expect(reason).toHaveAttribute("data-kind", "no-match");
  await expect(reason.getByTestId("silence-headline")).toHaveText(
    "No files contain these terms. Add more material or rephrase.",
  );
  // The soft banner is gone: the reason is the one thing said.
  await expect(page.locator('[data-testid^="product-state-"]')).toHaveCount(0);
  await expect(page.getByTestId("card-reason")).toContainText("Add more material or rephrase.");

  const expanded = reason.getByTestId("silence-expanded");
  await expect(expanded).toBeHidden();
  await reason.getByTestId("card-reason").click();
  await expect(expanded).toBeVisible();
  await expect(expanded.getByTestId("silence-index")).toHaveText(/^Indexed \d+ files?, \d+ chunks?\.$/);
  await expect(expanded.getByTestId("silence-no-hits")).toBeVisible();
  await expect(expanded.getByTestId("silence-skipped")).toHaveCount(0);

  // The keyboard works the same switch.
  await reason.getByTestId("card-reason").focus();
  await page.keyboard.press("Enter");
  await expect(expanded).toBeHidden();
});

test("related files read: the reason opens to the actual hits, and a hit opens its file", async ({ page }) => {
  await openCockpit(page);
  await typeQuestion(page, NOT_STATED);

  const reason = page.getByTestId("silence-reason");
  await expect(reason).toHaveAttribute("data-kind", "not-stated");
  await expect(reason.getByTestId("silence-headline")).toContainText("Check top hits");

  const considered = await page.evaluate(
    () =>
      (window.useMeetHint?.getState() as unknown as { card: { considered?: { path: string }[] } }).card.considered ?? [],
  );
  expect(considered.length).toBeGreaterThan(0);

  // The files are under the reason now, not in a second expander.
  await expect(page.getByTestId("card-considered")).toHaveCount(0);
  await expect(reason.getByTestId("silence-hits")).toBeHidden();
  await reason.getByTestId("card-reason").click();
  const hits = reason.getByTestId("silence-hits").getByTestId("card-considered-item");
  await expect(hits).toHaveCount(considered.length);
  await expect(hits.first()).toHaveAttribute("data-path", considered[0]!.path);

  await hits.first().click();
  await expect(page.getByTestId("file-viewer")).toContainText(considered[0]!.path);
});

test("skipped files are counted and listed under the reason", async ({ page }) => {
  await openCockpit(page);
  const reason = page.getByTestId("silence-reason");
  const nothingIndexed = "Nothing is indexed in this space yet, so there was nothing to search.";

  // With nothing skipped there is no count to state and no list to point at.
  await showCard(page, silentCard("index", nothingIndexed));
  await expect(reason).toHaveAttribute("data-kind", "index");
  await expect(reason.getByTestId("silence-headline")).toHaveText(
    "The index could not be used for this question. Add the material again, or reload.",
  );
  await expect(reason.getByTestId("silence-detail")).toHaveText(nothingIndexed);
  await expect(reason.getByTestId("silence-skipped")).toHaveCount(0);

  // Skip a file. The same Card now leads with the count, read from the index as it stands.
  await page.evaluate(() =>
    (window.useMeetHint?.getState() as unknown as { togglePackExclusion: (path: string) => Promise<void> }).togglePackExclusion(
      "README.md",
    ),
  );
  await expect(page.getByTestId("index-skipped-details")).toContainText("1 file skipped");
  await expect(reason.getByTestId("silence-headline")).toHaveText("1 file was skipped. See list.");
  await expect(reason.getByTestId("silence-detail")).toHaveText(nothingIndexed);
  await expect(reason.getByTestId("silence-skipped")).toBeHidden();
  await reason.getByTestId("card-reason").click();
  await expect(reason.getByTestId("silence-skipped")).toContainText("README.md");
  await expect(reason.getByTestId("silence-skipped")).toContainText("excluded from search in this space");

  // A question nothing matches lists the skipped file too, because the answer could be in it.
  await typeQuestion(page, WEATHER);
  await expect(reason).toHaveAttribute("data-kind", "no-match");
  await expect(reason.getByTestId("silence-headline")).toHaveText(
    "No files contain these terms. Add more material or rephrase.",
  );
  await reason.getByTestId("card-reason").click();
  const skipped = reason.getByTestId("silence-skipped");
  await expect(skipped).toContainText("1 file skipped");
  await expect(skipped).toContainText("README.md");
});

test("weak match and an unreachable model each say their own next step", async ({ page }) => {
  await openCockpit(page);

  await showCard(
    page,
    silentCard("weak-match", "Only weak matches found. Nothing in your files covers this closely enough to cite.", {
      considered: [{ kind: "file", path: "src/exporter/retry.ts", startLine: 1, endLine: 6 }],
    }),
  );
  const reason = page.getByTestId("silence-reason");
  await expect(reason.getByTestId("silence-headline")).toHaveText(
    "Found related files but low confidence. Check top hits.",
  );
  await reason.getByTestId("card-reason").click();
  await expect(reason.getByTestId("card-considered-item")).toHaveAttribute("data-path", "src/exporter/retry.ts");

  // Silent after a model failure: the composer already ran and had nothing to cite.
  await showCard(
    page,
    silentCard(
      "transport",
      "No API key is set, so the model could not read your files. Add an API key and ask again.",
    ),
  );
  await expect(reason).toHaveAttribute("data-kind", "transport");
  await expect(reason.getByTestId("silence-headline")).toHaveText(
    "Model unreachable. Local extraction found nothing to cite.",
  );
  await expect(reason.getByTestId("silence-detail")).toContainText("Add an API key and ask again.");
  await expect(page.getByTestId("card").getByRole("button", { name: "Add API key" })).toBeVisible();

  // The composer answered because the model could not be reached: the Card says so.
  await showCard(page, {
    say: "Attempts are capped at three.",
    citations: [],
    query: "Why three?",
    latencyMs: 9,
    source: "local",
    flightTier: "localCard",
    modelFallback: "The model did not respond in time. Check your connection and ask again.",
  });
  await expect(page.getByTestId("model-fallback-note")).toHaveText("Model unreachable. Using local extraction.");
  await expect(page.getByTestId("silence-reason")).toHaveCount(0);
});

test("a real space: a file skipped at load is listed under the reason, and Ask shows the same reason", async ({ page }) => {
  test.setTimeout(180_000);
  await installE2eMocks(page);
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await fillCreateContextIdentity(page, `silence-reason-${Date.now()}`);

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-files-button").click(),
  ]);
  await fileChooser.setFiles([
    { name: "billing.md", mimeType: "text/markdown", buffer: Buffer.from("# Billing\n\nInvoices are sent on the first of the month.\n") },
    { name: "blank.md", mimeType: "text/markdown", buffer: Buffer.from("") },
  ]);
  await waitForIndexing(page);
  await page.getByTestId("indexing-done").click();
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", { timeout: 30000 });
  const spaceId = await page.evaluate(() => window.useMeetHint?.getState?.().activeSpaceId ?? "");
  expect(spaceId).toBeTruthy();

  // Here retrieval does rank the one file for the question, so the reason does
  // not claim the terms are missing. It says the question looks unrelated.
  const unrelated = "This looks unrelated to what is loaded. Add more material or rephrase.";
  await typeQuestion(page, WEATHER);
  const live = page.getByTestId("card").getByTestId("silence-reason");
  await expect(live).toHaveAttribute("data-kind", "no-match");
  await expect(live.getByTestId("silence-headline")).toHaveText(unrelated);
  await live.getByTestId("card-reason").click();
  await expect(live.getByTestId("silence-hits").getByTestId("card-considered-item")).toHaveAttribute(
    "data-path",
    /billing\.md$/,
  );
  await expect(live.getByTestId("silence-index")).toHaveText("Indexed 1 file, 1 chunk.");
  await expect(live.getByTestId("silence-skipped")).toContainText("1 file skipped");
  await expect(live.getByTestId("silence-skipped")).toContainText("blank.md");

  await page.goto(`/context/${spaceId}/ask`);
  await page.getByTestId("ask-query").fill(WEATHER);
  await page.getByTestId("ask-submit").click();
  const ask = page.getByTestId("ask-card").getByTestId("silence-reason");
  await expect(ask.getByTestId("silence-headline")).toHaveText(unrelated, { timeout: 30000 });
  await expect(page.getByTestId("ask-card").locator('[data-testid^="product-state-"]')).toHaveCount(0);
  await ask.getByTestId("card-reason").click();
  await expect(ask.getByTestId("silence-index")).toHaveText("Indexed 1 file, 1 chunk.");
  await expect(ask.getByTestId("silence-hits").getByTestId("card-considered-item")).toHaveAttribute(
    "data-path",
    /billing\.md$/,
  );
  // A file left out at load was never stored. Its path and reason are kept
  // with the space, so it is still listed after the page reloaded.
  await expect(ask.getByTestId("silence-skipped")).toContainText("1 file skipped");
  await expect(ask.getByTestId("silence-skipped")).toContainText("blank.md");
});
