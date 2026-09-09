import { expect, test, type Page } from "@playwright/test";
import { installE2eMocks, typeQuestion, waitForCard, waitForIndexing } from "./fixtures/helpers";

test.setTimeout(90_000);

const MARKER = "USER_A_PRIVATE_92817";
const CONTEXT_NAME = "user-a-private-92817";

async function loadPrivateRepo(page: Page) {
  await installE2eMocks(page);
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "What are you working with?" })).toBeVisible();
  await page.getByRole("button", { name: "Work project" }).click();
  const name = page.getByTestId("context-name");
  await name.fill(CONTEXT_NAME);
  await expect(name).toHaveValue(CONTEXT_NAME);
  const submit = page.getByTestId("create-context-submit");
  await expect(submit).toBeEnabled();
  await submit.click();

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-files-button").click(),
  ]);
  await fileChooser.setFiles([
    {
      name: "secret.ts",
      mimeType: "text/plain",
      buffer: Buffer.from(`export const token = "${MARKER}";\n`),
    },
  ]);
  await waitForIndexing(page);
  await page.getByTestId("indexing-done").click();
  await page.getByTestId("start-live").click();
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", {
    timeout: 20000,
  });
}

test("a second browser profile cannot see another user's loaded repo", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await loadPrivateRepo(pageA);
  await typeQuestion(pageA, "What is the token?");
  const card = await waitForCard(pageA);
  await expect(card).toContainText(/token|secret|USER_A_PRIVATE|material|cover|generate/i);

  await installE2eMocks(pageB);
  await pageB.goto("/home");
  await expect(pageB.locator("body")).not.toContainText(CONTEXT_NAME);
  await expect(pageB.locator("body")).not.toContainText(MARKER);
  await expect(pageB.getByTestId("context-list")).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

test("signing in as B on the same profile does not surface A's repo", async ({ page }) => {
  await loadPrivateRepo(page);
  const contextId = await page.evaluate(() => window.useMeetHint?.getState?.().activeContextId ?? "");
  expect(contextId).toBeTruthy();

  await page.evaluate(async () => {
    if (!window.__meethintSwitchAccount) throw new Error("account switch hook missing");
    await window.__meethintSwitchAccount("user-b");
  });

  await page.goto("/home");
  await expect(page.locator("body")).not.toContainText(CONTEXT_NAME);
  await expect(page.locator("body")).not.toContainText(MARKER);
  await expect(page.getByTestId("context-list")).toHaveCount(0);

  await page.goto(`/context/${contextId}`);
  await expect(page.getByTestId("context-missing")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(MARKER);

  await page.goto(`/context/${contextId}/live`);
  await expect(page.locator("body")).not.toContainText(MARKER);
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready");
  const leaked = await page.evaluate((marker) => {
    const state = window.useMeetHint?.getState?.();
    const pack = state && "pack" in state ? (state as { pack?: { files?: Array<{ content: string }> } }).pack : null;
    return pack?.files?.some((file) => file.content.includes(marker)) ?? false;
  }, MARKER);
  expect(leaked).toBe(false);
});
