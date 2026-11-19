import { expect, test, type Page } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { fillCreateContextIdentity, installE2eMocks, waitForIndexing } from "./fixtures/helpers";

/**
 * Adding material to a space that already has sources: on the space detail
 * page and in the live cockpit, a selection with nothing readable must say so,
 * keep the existing material loaded, and never read as success.
 */
test.setTimeout(120_000);

const GOOD = {
  name: "auth.ts",
  mimeType: "text/plain",
  buffer: Buffer.from("/** Checkout requires E2E_TOKEN_A for every request. */\nexport const token = 'E2E_TOKEN_A';\n"),
};
const SECOND = {
  name: "billing.ts",
  mimeType: "text/plain",
  buffer: Buffer.from("/** Sessions expire after E2E_TIMEOUT_B minutes. */\nexport const timeout = 'E2E_TIMEOUT_B';\n"),
};
const UNREADABLE = {
  name: "photo.png",
  mimeType: "image/png",
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
};

async function spaceWithOneSource(page: Page, name: string) {
  await installE2eMocks(page);
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await fillCreateContextIdentity(page, name);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("upload-files-button").click()]);
  await chooser.setFiles([GOOD]);
  await waitForIndexing(page);
  await page.getByTestId("indexing-done").click();
  await page.goto("/home");
  await page.getByRole("link", { name }).click();
  await expect(page.getByTestId("space-detail")).toBeVisible();
  await expect(page.getByTestId("space-source-list").locator("tr")).toHaveCount(1, { timeout: 30000 });
}

async function addOnDetail(page: Page, files: (typeof GOOD)[]) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("upload-files-button").click()]);
  await chooser.setFiles(files);
}

test("space detail: unreadable selection reports failure and keeps existing sources", async ({ page }) => {
  await spaceWithOneSource(page, "Detail Feedback Space");

  await addOnDetail(page, [UNREADABLE]);
  const notice = page.getByTestId("space-add-notice");
  await expect(notice).toBeVisible({ timeout: 30000 });
  await expect(notice).toHaveAttribute("data-tone", "error");
  await expect(notice).toHaveAttribute("role", "alert");
  await expect(notice).toContainText("Nothing was added.");
  await expect(notice).toContainText("Your existing material is unchanged.");
  await expect(notice).not.toContainText("Material added");
  await expect(page.getByTestId("space-source-list").locator("tr")).toHaveCount(1);
  await expect(page.getByTestId("start-live")).toBeVisible();

  await addOnDetail(page, [SECOND]);
  await expect(notice).toHaveAttribute("data-tone", "ok", { timeout: 30000 });
  await expect(notice).toContainText("Material added.");
  // Each add is its own repo bundle, so the first source is still listed.
  await expect(page.getByTestId("space-source-list").locator("tr")).toHaveCount(2);
});

test("space detail: mixed selection with an unreadable file and a good file reports both", async ({ page }) => {
  await spaceWithOneSource(page, "Detail Mixed Space");
  await addOnDetail(page, [UNREADABLE, SECOND]);
  const notice = page.getByTestId("space-add-notice");
  await expect(notice).toBeVisible({ timeout: 30000 });
  // packFromFiles skips the png and saves billing.ts. A non-error tone alone is
  // not enough: the add must really land, without a save failure.
  await expect(notice).not.toHaveAttribute("data-tone", "error");
  // The png is skipped, so this is a warning that names the skip.
  await expect(notice).toHaveAttribute("data-tone", "warn");
  await expect(notice).toContainText("Some material was added.");
  await expect(notice).toContainText("Skipped 1");
  await expect(notice).not.toContainText("Could not save");
  await expect(page.getByTestId("space-source-list").locator("tr")).toHaveCount(2);
  await expect(page.getByTestId("space-source-list")).toContainText("billing.ts");
});

test("cockpit: unreadable upload keeps the space loaded and says nothing was added", async ({ page }) => {
  await spaceWithOneSource(page, "Cockpit Feedback Space");
  await page.getByTestId("start-live").click();
  await page.waitForURL(/\/context\/[^/]+\/live/);
  const spaceId = new URL(page.url()).pathname.split("/")[2];
  const cockpit = page.getByTestId("cockpit");
  // The store still holds the previous state until boot loads this space.
  await expect(cockpit).toHaveAttribute("data-booted", "true", { timeout: 30000 });
  await expect(cockpit).toHaveAttribute("data-space-id", spaceId, { timeout: 30000 });
  await expect(cockpit).toHaveAttribute("data-context-status", "ready", { timeout: 30000 });
  const sourceCount = await cockpit.getAttribute("data-source-count");

  await page.locator("input[data-files-input]").setInputFiles([UNREADABLE]);
  const notice = page.getByTestId("add-material-notice");
  await expect(notice).toBeVisible({ timeout: 30000 });
  await expect(notice).toHaveAttribute("data-tone", "error");
  await expect(notice).toContainText("Nothing was added.");
  await expect(cockpit).toHaveAttribute("data-context-status", "ready");
  await expect(cockpit).toHaveAttribute("data-space-id", spaceId);
  if (sourceCount) await expect(cockpit).toHaveAttribute("data-source-count", sourceCount);
  await expect(page.getByTestId("space-switcher")).not.toHaveAttribute("aria-label", "Loading…");

  // A good file joins the same space instead of opening a new one.
  await page.locator("input[data-files-input]").setInputFiles([SECOND]);
  await expect(notice).toHaveAttribute("data-tone", "ok", { timeout: 30000 });
  await expect(notice).toContainText("Material added.");
  await expect(cockpit).toHaveAttribute("data-space-id", spaceId);
  if (sourceCount) await expect(cockpit).not.toHaveAttribute("data-source-count", sourceCount);
});
