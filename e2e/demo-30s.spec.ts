import { expect, test } from "@playwright/test";

const AUTH_ROUTES = /\/(login|sign-in|auth\/)/;

test("public demo cites a chip without login or a microphone prompt", async ({ page }) => {
  const started = Date.now();
  await page.goto("/demo");
  await expect(page).not.toHaveURL(AUTH_ROUTES);
  await expect(page.getByTestId("demo-search")).toBeVisible();
  await expect(page.getByTestId("demo-chip")).toHaveCount(3);

  const mic = page.waitForEvent("dialog", { timeout: 500 }).catch(() => null);
  await page.getByTestId("demo-chip").nth(2).click();
  await expect(page.getByTestId("card-say")).toContainText(/three/i);
  await expect(page.getByTestId("demo-cite")).toContainText(/retry/i);
  expect(await mic).toBeNull();
  expect(Date.now() - started).toBeLessThan(30_000);
});
