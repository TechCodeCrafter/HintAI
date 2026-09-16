import { expect, test } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { fillCreateContextIdentity, installE2eMocks, waitForIndexing } from "./fixtures/helpers";

test.setTimeout(120_000);

const KEEP_SPACE = "Keep Space E2E";
const DELETE_SPACE = "Delete Space E2E";
const KEEP_MARKER = "DELETE_UX_KEEP_92817";
const DELETE_MARKER = "DELETE_UX_DROP_92817";

async function createSpaceWithMarker(page: import("@playwright/test").Page, name: string, marker: string) {
  await page.goto("/create");
  await fillCreateContextIdentity(page, name);
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-files-button").click(),
  ]);
  await fileChooser.setFiles([
    {
      name: `${name.replace(/\s+/g, "-").toLowerCase()}.ts`,
      mimeType: "text/plain",
      buffer: Buffer.from(`export const marker = "${marker}";\n`),
    },
  ]);
  await waitForIndexing(page);
  await page.getByTestId("indexing-done").click();
  await page.goto("/home");
  await expect(page.getByRole("link", { name })).toBeVisible();
}

test("beta gate: deleted Knowledge Space disappears immediately and cannot reopen", async ({ page }) => {
  await installE2eMocks(page);
  await e2eSignIn(page, USER_A);

  await createSpaceWithMarker(page, KEEP_SPACE, KEEP_MARKER);
  await page.getByRole("link", { name: KEEP_SPACE }).click();
  await expect(page.getByTestId("space-detail")).toBeVisible();
  const keepSpaceId = page.url().match(/\/context\/([^/?#]+)/)?.[1] ?? "";
  expect(keepSpaceId).toBeTruthy();

  await createSpaceWithMarker(page, DELETE_SPACE, DELETE_MARKER);
  await page.getByRole("link", { name: DELETE_SPACE }).click();
  await expect(page.getByTestId("space-detail")).toBeVisible();
  const deletedSpaceId = page.url().match(/\/context\/([^/?#]+)/)?.[1] ?? "";
  expect(deletedSpaceId).toBeTruthy();
  expect(deletedSpaceId).not.toBe(keepSpaceId);

  await page.goto(`/context/${deletedSpaceId}`);
  await expect(page.getByTestId("space-detail")).toBeVisible();
  await page.getByTestId("delete-space").click();
  await page.getByTestId("confirm-delete").click();

  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole("link", { name: DELETE_SPACE })).toHaveCount(0);
  await expect(page.getByRole("link", { name: KEEP_SPACE })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(DELETE_MARKER);

  await page.getByRole("link", { name: KEEP_SPACE }).click();
  await expect(page.getByTestId("space-detail")).toBeVisible();
  await expect(page.getByTestId("space-source-list").locator("li")).toHaveCount(1);
  await page.getByRole("link", { name: "Ask" }).click();
  await page.getByTestId("ask-query").fill(KEEP_MARKER);
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("ask-card")).toContainText(KEEP_MARKER, { timeout: 30000 });

  await page.goto(`/context/${deletedSpaceId}`);
  await expect(page.getByTestId("space-missing")).toBeVisible();
  await expect(page.getByTestId("space-detail")).toHaveCount(0);

  const activeSpaceId = await page.evaluate(() => window.useMeetHint?.getState?.().activeSpaceId ?? null);
  expect(activeSpaceId).not.toBe(deletedSpaceId);
  expect(activeSpaceId === null || activeSpaceId === keepSpaceId).toBe(true);
});
