import { expect, type Page } from "@playwright/test";

import { installE2eMocks, openCockpit, typeQuestion, waitForCard } from "./helpers";

const AUTH_ROUTES = /\/(login|sign-in|auth\/)/;

/** Funnel routes must never redirect to sign-in. */
export async function assertNoAuthRedirect(page: Page, path: string) {
  await page.goto(path);
  await expect(page).not.toHaveURL(AUTH_ROUTES);
}

export async function runHomeFirstProof(page: Page) {
  await installE2eMocks(page);
  const started = Date.now();
  await assertNoAuthRedirect(page, "/home");
  await expect(page.getByText("Looking for saved contexts")).toHaveCount(0);
  await expect(page.getByTestId("home-proof-chips")).toBeVisible();
  await expect(page.getByTestId("home-proof-chip")).toHaveCount(3);
  await page.getByTestId("home-proof-chip").nth(2).click();
  const card = page.getByTestId("card");
  await expect(card.getByTestId("card-say")).toBeVisible({ timeout: 2000 });
  await expect(card.getByTestId("card-say")).toContainText("three");
  await expect(page.getByTestId("home-proof-cite")).toContainText("retry");
  expect(Date.now() - started).toBeLessThan(15000);
}

export async function runCockpitDemoSearch(page: Page) {
  await openCockpit(page);
  await expect(page).not.toHaveURL(AUTH_ROUTES);
  await expect(page.getByTestId("anonymous-tier-error")).toHaveCount(0);
  await typeQuestion(page, "Why does that retry three times?");
  await waitForCard(page, { allowNull: false });
  await expect(page.getByTestId("card-say")).toContainText(/retry|three/i);
}
