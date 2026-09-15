import { test } from "@playwright/test";

import { expectProtectedRedirect } from "./fixtures/auth";

/** Public marketing routes stay reachable without a session. */
test.describe("public routes", () => {
  test("landing stays open without sign-in", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("landing").waitFor();
  });

  test("privacy and terms stay open without sign-in", async ({ page }) => {
    await page.goto("/privacy");
    await page.getByRole("heading", { name: /privacy/i }).waitFor();
    await page.goto("/terms");
    await page.getByRole("heading", { name: /terms/i }).waitFor();
  });

  test("protected product routes redirect to login", async ({ page }) => {
    await page.goto("/home");
    await expectProtectedRedirect(page);
    await page.goto("/app");
    await expectProtectedRedirect(page);
  });
});
