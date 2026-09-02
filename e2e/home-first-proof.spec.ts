import { expect, test } from "@playwright/test";
import { installE2eMocks } from "./fixtures/helpers";

test("first visit proves Search on the demo pack", async ({ page }) => {
  await installE2eMocks(page);
  const started = Date.now();
  await page.goto("/home");
  await expect(page.getByText("Looking for saved contexts")).toHaveCount(0);
  await expect(page.getByTestId("home-proof-chips")).toBeVisible();
  await expect(page.getByTestId("home-proof-chip")).toHaveCount(3);
  await expect(page.getByTestId("home-proof-chip").nth(0)).toHaveText(
    "What is the architecture of this application?",
  );
  await expect(page.getByTestId("home-proof-chip").nth(1)).toHaveText("What did we change in the exporter?");
  await expect(page.getByTestId("home-proof-chip").nth(2)).toHaveText("Why does that retry three times?");
  await expect(page.getByTestId("home-proof-hint")).toHaveText("Load your own folder from the repo pane →");
  await page.getByTestId("home-proof-chip").nth(2).click();
  const card = page.getByTestId("card");
  await expect(card.getByTestId("card-say")).toBeVisible({ timeout: 2000 });
  await expect(card.getByTestId("card-say")).toContainText("three");
  await expect(page.getByTestId("home-proof-cite")).toContainText("retry");
  expect(Date.now() - started).toBeLessThan(15000);
});
