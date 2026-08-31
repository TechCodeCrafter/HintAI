import { expect, test } from "@playwright/test";

test("landing shows the demo and accepts a waitlist signup", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing")).toBeVisible();
  await expect(page.getByRole("heading", { name: /The meeting just became searchable/ })).toBeVisible();
  await expect(page.getByText("They asked", { exact: true })).toBeVisible();

  const email = page.getByTestId("hero-email-input");
  await email.click();
  await email.pressSequentially("demo@meethint.ai");
  await expect(page.getByTestId("hero-email-submit")).toBeEnabled();
  await page.getByTestId("hero-email-submit").click();
  await expect(page.getByTestId("waitlist-done").first()).toBeVisible();
});
