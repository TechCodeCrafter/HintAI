import { expect, test } from "@playwright/test";

test("landing shows the demo and accepts a waitlist signup", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Know the answer/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Bring the material/ })).toBeVisible();
  await expect(page.getByText("forty repositories")).toHaveCount(0);
  await expect(page.getByText("They asked", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Cite it, or generate it.").first()).toBeVisible();
  await expect(page.getByText("Nothing is generated")).toHaveCount(0);

  const email = page.getByTestId("hero-email-input");
  await email.click();
  await email.pressSequentially("demo@meethint.ai");
  await expect(page.getByTestId("hero-email-submit")).toBeEnabled();
  await page.getByTestId("hero-email-submit").click();
  await expect(page.getByTestId("waitlist-done").first()).toBeVisible();
});
