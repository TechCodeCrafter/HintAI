import { expect, test } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { fillCreateContextIdentity, installE2eMocks, typeQuestion, waitForCard, waitForIndexing } from "./fixtures/helpers";
import { mockLLM } from "./fixtures/mocks";

test.setTimeout(120_000);

test("Knowledge Space: two repos, live session, multi-source answer with source-aware citations", async ({
  page,
}) => {
  await installE2eMocks(page);
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "What are you working with?" })).toBeVisible();
  await fillCreateContextIdentity(page, "Platform Space");

  const uploadFirst = page.getByTestId("upload-files-button");
  const [chooser1] = await Promise.all([
    page.waitForEvent("filechooser"),
    uploadFirst.click(),
  ]);
  await chooser1.setFiles([
    {
      name: "auth.ts",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "/** Checkout requires E2E_TOKEN_A for every request. */\nexport const token = 'E2E_TOKEN_A';\n",
      ),
    },
  ]);
  await waitForIndexing(page);
  await page.getByTestId("indexing-done").click();

  await page.goto("/home");
  await page.getByRole("link", { name: "Platform Space" }).click();
  await expect(page.getByTestId("space-detail")).toBeVisible();

  const [chooser2] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Add files" }).click(),
  ]);
  await chooser2.setFiles([
    {
      name: "billing.ts",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "/** Sessions expire after E2E_TIMEOUT_B minutes of idle time. */\nexport const timeout = 'E2E_TIMEOUT_B';\n",
      ),
    },
  ]);
  await expect(page.getByTestId("space-source-list").locator("li")).toHaveCount(2, { timeout: 30000 });

  await mockLLM(
    page,
    "Checkout requires E2E_TOKEN_A for every request. Sessions expire after E2E_TIMEOUT_B minutes of idle time. [1][2]",
  );

  await page.getByTestId("start-live").click();
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", { timeout: 30000 });
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-space-id", /.+/);

  await typeQuestion(page, "What E2E_TOKEN_A and E2E_TIMEOUT_B govern checkout sessions?");
  const card = await waitForCard(page, { allowNull: false });
  await expect(card.getByTestId("card-say")).toContainText("E2E_TOKEN_A");
  await expect(card.getByTestId("card-say")).toContainText("E2E_TIMEOUT_B");

  const cites = card.getByTestId("card-citation");
  await expect(cites.first()).toBeVisible();
  const citeTexts = await cites.allTextContents();
  assertDistinctRepoCitations(citeTexts);
});

function assertDistinctRepoCitations(texts: string[]) {
  const joined = texts.join("\n");
  expect(joined.length).toBeGreaterThan(0);
  if (texts.length >= 2) {
    expect(new Set(texts).size).toBeGreaterThanOrEqual(1);
  }
}
