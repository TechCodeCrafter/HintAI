import { expect, test } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import {
  fillCreateContextIdentity,
  installE2eMocks,
  typeQuestion,
  waitForCard,
  waitForIndexing,
} from "./fixtures/helpers";

test.setTimeout(90_000);

test("Create Knowledge Space, add files, search, delete", async ({ page }) => {
  await installE2eMocks(page);
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "What are you working with?" })).toBeVisible();
  await fillCreateContextIdentity(page, "Test Project");

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-files-button").click(),
  ]);
  await fileChooser.setFiles([
    {
      name: "retry.ts",
      mimeType: "text/plain",
      buffer: Buffer.from(`/**
 * Retry policy for settlement exports.
 *
 * Attempts are capped at three because the payment gateway stalls rather than
 * failing fast, so a fourth attempt duplicates the settlement file instead of
 * recovering it.
 */
export const MAX_ATTEMPTS = 3;
`),
    },
  ]);

  await waitForIndexing(page);
  await expect(page.getByTestId("index-stats")).toContainText("1");
  await expect(page.getByTestId("index-stats")).toContainText("source");

  await page.getByTestId("indexing-done").click();
  await page.getByTestId("start-live").click();
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", {
    timeout: 20000,
  });

  await typeQuestion(page, "Why does that retry three times?");
  const card = await waitForCard(page, { allowNull: false });
  await expect(card.getByTestId("card-say")).toContainText("three");

  await page.goto("/home");
  await page.getByRole("link", { name: "Test Project" }).click();
  await page.getByTestId("delete-space").click();
  await page.getByTestId("confirm-delete").click();
  await expect(page.getByTestId("create-space-button")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Test Project");
});
