import { expect, type Page } from "@playwright/test";
import { e2eSignIn, type E2eUser } from "./auth";
import { fillCreateContextIdentity, installE2eMocks, waitForIndexing } from "./helpers";

export const PERSISTENCE_MARKER = "PERSISTENCE_GATE_92817";
export const PERSISTENCE_SPACE = "persistence-gate-space";
export const PERSISTENCE_QUESTION = "What is the persistence gate token value?";

export async function createIndexedSpace(page: Page, user: E2eUser) {
  await installE2eMocks(page);
  await e2eSignIn(page, user);
  await page.goto("/create");
  await fillCreateContextIdentity(page, PERSISTENCE_SPACE);

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-files-button").click(),
  ]);
  await fileChooser.setFiles([
    {
      name: "persistence-gate.ts",
      mimeType: "text/plain",
      buffer: Buffer.from(`export const token = "${PERSISTENCE_MARKER}";\n`),
    },
  ]);
  await waitForIndexing(page);
  await page.getByTestId("indexing-done").click();

  await page.goto("/home");
  await page.getByRole("link", { name: PERSISTENCE_SPACE }).click();
  await expect(page.getByTestId("space-detail")).toBeVisible({ timeout: 30000 });
  const spaceId = page.url().match(/\/context\/([^/?#]+)/)?.[1] ?? "";
  expect(spaceId).toBeTruthy();

  await page.getByRole("link", { name: "Ask" }).click();
  await page.getByTestId("ask-query").fill(PERSISTENCE_MARKER);
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("ask-card")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("ask-card")).toContainText(PERSISTENCE_MARKER);

  return { spaceId };
}

export async function expectSpacePersisted(page: Page, spaceId: string) {
  await page.goto("/home");
  await expect(page.getByRole("link", { name: PERSISTENCE_SPACE })).toBeVisible();

  await page.goto(`/context/${spaceId}`);
  await expect(page.getByTestId("space-detail")).toBeVisible();
  await expect(page.getByTestId("space-source-list").locator("tr")).toHaveCount(1, { timeout: 30000 });

  await page.getByRole("link", { name: "Ask" }).click();
  await expect(page.getByTestId("ask-query")).toBeEnabled({ timeout: 30000 });
  await page.getByTestId("ask-query").fill(PERSISTENCE_MARKER);
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("ask-card")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("ask-card")).toContainText(PERSISTENCE_MARKER);

  await page.goto(`/context/${spaceId}/live`);
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", {
    timeout: 30000,
  });
}

export async function expectTenantEmpty(page: Page, spaceId: string) {
  await page.goto("/home");
  await expect(page.locator("body")).not.toContainText(PERSISTENCE_SPACE);
  await expect(page.locator("body")).not.toContainText(PERSISTENCE_MARKER);
  await expect(page.getByTestId("space-list")).toHaveCount(0);

  await page.goto(`/context/${spaceId}`);
  await expect(page.getByTestId("space-missing")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(PERSISTENCE_MARKER);

  await page.goto(`/context/${spaceId}/ask`);
  await expect(page.getByTestId("ask-card")).toHaveCount(0);
  await expect(page.getByTestId("card-citation")).toHaveCount(0);

  const leaked = await page.evaluate((marker) => {
    const state = window.useMeetHint?.getState?.();
    if (!state) return { pack: false, history: false, card: false };
    const pack = state.pack?.files?.some((file) => file.content.includes(marker)) ?? false;
    const history =
      state.answerHistory?.some(
        (item) => item.query.includes(marker) || (item.say ?? "").includes(marker),
      ) ?? false;
    const card = (state.card?.say ?? "").includes(marker) || (state.card?.query ?? "").includes(marker);
    return { pack, history, card };
  }, PERSISTENCE_MARKER);
  expect(leaked.pack).toBe(false);
  expect(leaked.history).toBe(false);
  expect(leaked.card).toBe(false);
}

export async function verifyRefreshRecovery(page: Page, spaceId: string) {
  await page.goto("/home");
  await expect(page.getByRole("link", { name: PERSISTENCE_SPACE })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: PERSISTENCE_SPACE })).toBeVisible();

  await page.getByRole("link", { name: "Ask" }).first().click();
  await expect(page.getByTestId("ask-query")).toBeEnabled({ timeout: 30000 });
  await page.reload();
  await expect(page.getByTestId("ask-query")).toBeEnabled({ timeout: 30000 });
  await page.getByTestId("ask-query").fill(PERSISTENCE_MARKER);
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("ask-card")).toContainText(PERSISTENCE_MARKER);

  await page.goto(`/context/${spaceId}/live`);
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", {
    timeout: 30000,
  });
  await page.reload();
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", {
    timeout: 30000,
  });
}
