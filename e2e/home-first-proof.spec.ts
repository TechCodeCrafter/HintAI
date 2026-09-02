import { expect, test } from "@playwright/test";
import { installE2eMocks } from "./fixtures/helpers";

test("first visit proves Search on the demo pack", async ({ page }) => {
  await installE2eMocks(page);
  const started = Date.now();
  await page.goto("/home");
  await expect(page.getByText("Looking for saved contexts")).toHaveCount(0);
  await expect(page.getByTestId("home-try-question")).toHaveText("Try: 'What does the auth service do?'");
  await page.getByRole("button", { name: "Search" }).click();
  const card = page.getByTestId("card");
  await expect(card.getByTestId("card-say")).toBeVisible({ timeout: 2000 });
  await expect(card.getByTestId("card-say")).toContainText("auth service verifies");
  await expect(page.getByTestId("home-proof-cite")).toContainText("src/auth.ts line 47");
  await expect(page.getByTestId("home-proof-cite")).toContainText("Load your own folder");
  expect(Date.now() - started).toBeLessThan(15000);
});
