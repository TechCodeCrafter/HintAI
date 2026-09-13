import { expect, test } from "@playwright/test";
import { fillControlledInput } from "./fixtures/helpers";

test("landing shows the demo and accepts a waitlist signup", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("meethint.waitlist"));
  await page.goto("/");
  await expect(page.getByTestId("landing")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Know the answer/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Bring the material/ })).toBeVisible();
  await expect(page.getByText("forty repositories")).toHaveCount(0);
  await expect(page.getByText("They asked", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Cite it, or stay silent.").first()).toBeVisible();
  await expect(page.getByText("Nothing is generated")).toHaveCount(0);

  const email = page.getByTestId("hero-email-input");
  const submit = page.getByTestId("hero-email-submit");
  await expect(async () => {
    await fillControlledInput(email, "demo@meethint.ai");
    await expect(submit).toBeEnabled();
  }).toPass({ timeout: 15000 });
  await submit.click();
  await expect(page.getByTestId("waitlist-done").first()).toBeVisible();
});
