import { expect, test } from "@playwright/test";
import {
  e2eSignIn,
  e2eSignOut,
  expectProtectedRedirect,
  USER_A,
  USER_B,
} from "./fixtures/auth";
import {
  fillCreateContextIdentity,
  installE2eMocks,
  typeQuestion,
  waitForCard,
  waitForIndexing,
} from "./fixtures/helpers";
import { mockLLM } from "./fixtures/mocks";

test.setTimeout(180_000);

const MARKER = "PRIVATE_WS_GATE_92817";
const SPACE_NAME = "private-ws-gate-space";
const QUESTION = "What is the secret token value?";

test("beta gate: authenticated users cannot access each other's private workspaces", async ({ page }) => {
  await installE2eMocks(page);

  // —— User A: login, upload secret, search on Ask and Live ——
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await fillCreateContextIdentity(page, SPACE_NAME);

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
    timeout: 30000,
  });

  const spaceId = await page.evaluate(() => window.useMeetHint?.getState?.().activeSpaceId ?? "");
  expect(spaceId).toBeTruthy();
  await expect(page.locator("body")).toContainText(MARKER);

  await mockLLM(page, `The secret token is ${MARKER}.`);
  await typeQuestion(page, QUESTION);
  const liveCard = await waitForCard(page);
  await expect(liveCard).toContainText(new RegExp(`token|secret|material|cover|generate|${MARKER}`, "i"));

  await page.goto("/home");
  await expect(page.getByRole("link", { name: SPACE_NAME })).toBeVisible();

  await page.getByRole("link", { name: "Ask" }).first().click();
  await page.getByTestId("ask-query").fill(MARKER);
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("ask-card")).toBeVisible({ timeout: 30000 });

  await page.goto(`/context/${spaceId}/live`);
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", {
    timeout: 30000,
  });
  await mockLLM(page, `Confirmed: ${MARKER} is the token.`);
  await typeQuestion(page, "Confirm the token again");
  await waitForCard(page);
  const historyToggle = page.getByTestId("answer-history-toggle");
  if (await historyToggle.isVisible().catch(() => false)) {
    await historyToggle.click();
    await expect(page.getByTestId("answer-history-list")).toContainText(/token|secret|Confirm/i);
  }

  // —— User A logs out; tenant state must not linger ——
  await e2eSignOut(page);
  await page.goto("/home");
  await expectProtectedRedirect(page);

  // —— User B: must not see, guess, retrieve, or inherit User A's knowledge ——
  await e2eSignIn(page, USER_B);
  await page.goto("/home");
  await expect(page.locator("body")).not.toContainText(SPACE_NAME);
  await expect(page.locator("body")).not.toContainText(MARKER);
  await expect(page.getByTestId("space-list")).toHaveCount(0);

  await page.goto(`/context/${spaceId}`);
  await expect(page.getByTestId("space-missing")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(MARKER);

  await mockLLM(page, `The secret token is ${MARKER}.`);
  await page.goto(`/context/${spaceId}/ask`);
  await expect(page.locator("body")).not.toContainText(MARKER);
  await expect(page.getByTestId("ask-card")).toHaveCount(0);
  await expect(page.getByTestId("card-citation")).toHaveCount(0);

  await page.goto(`/context/${spaceId}/live`);
  await expect(page.locator("body")).not.toContainText(MARKER);
  await expect(page.getByTestId("answer-history")).toHaveCount(0);

  const leaked = await page.evaluate((marker) => {
    const state = window.useMeetHint?.getState?.();
    if (!state) return { pack: false, history: false, card: false, contexts: false };
    const pack = state.pack?.files?.some((file) => file.content.includes(marker)) ?? false;
    const history =
      state.answerHistory?.some(
        (item) => item.query.includes(marker) || (item.say ?? "").includes(marker),
      ) ?? false;
    const card = (state.card?.say ?? "").includes(marker);
    const contexts = state.contexts?.some((row) => row.name.includes("private-ws-gate")) ?? false;
    return { pack, history, card, contexts };
  }, MARKER);
  expect(leaked.pack).toBe(false);
  expect(leaked.history).toBe(false);
  expect(leaked.card).toBe(false);
  expect(leaked.contexts).toBe(false);

  const searchInput = page.getByTestId("search-input");
  if (await searchInput.isVisible().catch(() => false)) {
    await typeQuestion(page, QUESTION);
    await page.waitForTimeout(3000);
    await expect(page.locator("body")).not.toContainText(MARKER);
    await expect(page.getByTestId("card-citation")).toHaveCount(0);
    await expect(page.getByTestId("answer-history")).toHaveCount(0);
  }
});
