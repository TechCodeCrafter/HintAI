import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { fillCreateContextIdentity, installE2eMocks, waitForIndexing } from "./fixtures/helpers";
import { textPdf } from "./fixtures/pdf";

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function folder(name: string): string {
  const dir = join(tmpdir(), `hint-${name}-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function openMaterialStep(page: Page, name: string) {
  await installE2eMocks(page);
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await fillCreateContextIdentity(page, name);
  await expect(page.getByTestId("upload-folder-button")).toBeVisible();
}

async function chooseFolder(page: Page, dir: string) {
  const chooser = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.getByTestId("upload-folder-button").click();
  await (await chooser).setFiles(dir);
}

async function chooseFiles(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const chooser = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.getByTestId("upload-files-button").click();
  await (await chooser).setFiles(files);
}

test("files that cannot be read end as a failure, never as Ready", async ({ page }) => {
  await openMaterialStep(page, "Unreadable Files");
  await chooseFiles(page, [
    { name: "photo.png", mimeType: "image/png", buffer: PNG },
    { name: "scan.png", mimeType: "image/png", buffer: PNG },
  ]);

  const failed = page.getByTestId("indexing-failed");
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("Nothing was indexed");
  await expect(page.getByTestId("indexing-failed-reason")).toContainText(/2 selected files/);
  await expect(page.getByTestId("indexing-failed-reason")).toContainText(/images/);
  await expect(page.getByTestId("indexing-failed-reason")).toContainText(
    "Choose code, Markdown, text, PDF, Word, Excel, or PowerPoint files.",
  );
  // The contradictions from the bug report are gone.
  await expect(page.getByText("Your material is indexed")).toHaveCount(0);
  await expect(page.getByTestId("indexing-done")).toHaveCount(0);
  await expect(page.getByTestId("index-stats")).toHaveCount(0);

  // The person can go straight back and pick something that works.
  await page.getByTestId("indexing-retry").click();
  await chooseFiles(page, [
    { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Notes\n\nThe export retries three times.\n") },
  ]);
  await waitForIndexing(page);
  await expect(page.getByTestId("indexing-complete")).toContainText("Ready");
  await expect(page.getByTestId("index-stats")).toContainText("100%");
  await expect(page.getByTestId("indexing-done")).toBeEnabled();
});

test("a new space does not count the previous pack's evidence while indexing fails", async ({ page }) => {
  await openMaterialStep(page, "Stale Counts");
  await chooseFiles(page, [{ name: "photo.png", mimeType: "image/png", buffer: PNG }]);
  await expect(page.getByTestId("indexing-failed")).toBeVisible();
  await expect(page.getByTestId("indexing-failed-reason")).toContainText(/selected file was/i);
});

test("a folder with nothing usable is stopped at review with the reason", async ({ page }) => {
  await openMaterialStep(page, "Image Folder");
  const dir = folder("images");
  writeFileSync(join(dir, "a.png"), PNG);
  writeFileSync(join(dir, "b.png"), PNG);
  await chooseFolder(page, dir);

  const dialog = page.getByTestId("review-pack-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("review-pack-summary")).toContainText("0 files will be indexed");
  await expect(dialog).toContainText(/images/);
  await expect(page.getByTestId("review-pack-index")).toBeDisabled();
});

test("a folder of PDFs is indexed instead of being skipped as binaries", async ({ page }) => {
  await openMaterialStep(page, "PDF Folder");
  const dir = folder("pdfs");
  writeFileSync(
    join(dir, "retention-policy.pdf"),
    textPdf(["Data retention policy", "Customer exports are kept for ninety days and then deleted."]),
  );
  writeFileSync(
    join(dir, "runbook.pdf"),
    textPdf(["Exporter runbook", "Restart the exporter worker when the queue depth passes five hundred."]),
  );
  await chooseFolder(page, dir);

  await expect(page.getByTestId("review-pack-summary")).toContainText("2 PDFs will be indexed");
  await expect(page.getByTestId("review-pack-index")).toBeEnabled();
  await page.getByTestId("review-pack-index").click();

  await waitForIndexing(page);
  await expect(page.getByTestId("indexing-complete")).toContainText("Ready");
  await expect(page.getByTestId("indexing-failed")).toHaveCount(0);
});

test("a folder mixing code and PDFs indexes both", async ({ page }) => {
  await openMaterialStep(page, "Mixed Folder");
  const dir = folder("mixed");
  writeFileSync(join(dir, "retry.ts"), "export const MAX_ATTEMPTS = 3;\n");
  writeFileSync(join(dir, "runbook.md"), "# Runbook\n\nRestart the job after three failed attempts.\n");
  writeFileSync(join(dir, "logo.png"), PNG);
  writeFileSync(join(dir, "policy.pdf"), textPdf(["Refund policy", "Refunds are issued within fourteen days."]));
  await chooseFolder(page, dir);

  await expect(page.getByTestId("review-pack-summary")).toContainText("2 files and 1 PDF will be indexed");
  await expect(page.getByTestId("review-pack-summary")).toContainText("1 skipped");
  await page.getByTestId("review-pack-index").click();
  await waitForIndexing(page);
  await expect(page.getByTestId("indexing-complete")).toContainText("Ready");
  await page.getByTestId("indexing-done").click();
  await expect(page.getByTestId("space-switcher")).toHaveAttribute("aria-label", "Mixed Folder · 3 sources");
});

test("a folder holding one corrupt PDF ends as a failure that names the file", async ({ page }) => {
  await openMaterialStep(page, "Corrupt PDF Folder");
  const dir = folder("corrupt-pdf");
  writeFileSync(join(dir, "broken.pdf"), Buffer.concat([Buffer.from("%PDF-1.4\n", "latin1"), Buffer.from("not a real pdf body ".repeat(40))]));
  await chooseFolder(page, dir);

  const index = page.getByTestId("review-pack-index");
  await expect(index).toBeEnabled();
  await index.click();

  const failed = page.getByTestId("indexing-failed");
  await expect(failed).toBeVisible({ timeout: 30000 });
  await expect(failed).toContainText("Nothing was indexed");
  await expect(page.getByTestId("indexing-failed-reason")).toContainText("broken.pdf");
  await expect(page.getByText("Your material is indexed")).toHaveCount(0);
  await expect(page.getByTestId("indexing-done")).toHaveCount(0);
  await expect(page.getByTestId("index-stats")).toHaveCount(0);
  await expect(page.getByTestId("indexing")).toHaveCount(0);
  await expect(page.getByTestId("indexing-retry")).toBeVisible();
  await expect(failed).toContainText("still empty");
  await expect(page.getByTestId("create-tip")).not.toContainText("Be specific with the name");

  // Recovery: the unusable PDF was taken back, so a good folder ends Ready
  // with only its own three sources and no leftover warning.
  await page.getByTestId("indexing-retry").click();
  const good = folder("after-corrupt");
  writeFileSync(join(good, "auth.ts"), "export const token = 'RECOVER_TOKEN_A';\n");
  writeFileSync(join(good, "billing.ts"), "export const timeout = 'RECOVER_TIMEOUT_B';\n");
  writeFileSync(join(good, "README.md"), "# Recovery\n\nRefunds take RECOVER_DAYS_C days.\n");
  await chooseFolder(page, good);
  await page.getByTestId("review-pack-index").click();
  await waitForIndexing(page);
  const complete = page.getByTestId("indexing-complete");
  await expect(complete).toContainText("Ready");
  const sources = page.getByTestId("index-stats").locator("div.ds-surface").filter({ hasText: "Sources" });
  await expect(sources.locator("p.text-2xl")).toHaveText("3");
  await expect(page.getByText("broken.pdf")).toHaveCount(0);
  await expect(page.getByTestId("indexing-note")).toHaveCount(0);
  await expect(page.getByTestId("create-tip")).toContainText("Choose Done");
  await page.getByTestId("indexing-done").click();
  await expect(page.getByTestId("space-switcher")).toHaveAttribute("aria-label", "Corrupt PDF Folder · 3 sources");
});
