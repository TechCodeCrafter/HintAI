import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { installE2eMocks, waitForIndexing } from "./fixtures/helpers";

test("folder upload reviews the pack before indexing", async ({ page }) => {
  await installE2eMocks(page);
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "What are you working with?" })).toBeVisible();
  await page.getByTestId("context-type-work").click();
  const name = page.getByTestId("context-name");
  await name.fill("Review Pack");
  await expect(name).toHaveValue("Review Pack");
  const submit = page.getByTestId("create-context-submit");
  await expect(submit).toBeEnabled();
  await submit.click();

  await page.getByRole("heading", { name: "Add material" }).waitFor();
  const folder = join(tmpdir(), `hint-review-pack-${Date.now()}`);
  mkdirSync(folder);
  writeFileSync(join(folder, "retry.ts"), "export const MAX_ATTEMPTS = 3;\n");
  writeFileSync(join(folder, "retry.test.ts"), "test('retry', () => {});\n");
  await page.getByTestId("folder-input").setInputFiles(folder);

  const dialog = page.getByTestId("review-pack-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("review-pack-summary")).toContainText("1 file will be indexed");
  await expect(page.getByTestId("review-pack-summary")).toContainText("1 skipped");
  await expect(page.getByTestId("review-pack-summary")).toContainText("Stays local");
  await expect(dialog).toContainText("Skip tests");

  await page.getByTestId("review-pack-include-tests").check();
  await expect(page.getByTestId("review-pack-summary")).toContainText("2 files will be indexed");

  await page.getByTestId("review-pack-include-tests").uncheck();
  await page.getByTestId("review-pack-index").click();
  await waitForIndexing(page);
  await expect(page.getByTestId("index-stats")).toContainText("1");
});
