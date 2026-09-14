import { test } from "@playwright/test";

import { assertNoAuthRedirect, runCockpitDemoSearch, runHomeFirstProof } from "./fixtures/funnel";

test.describe("@auth-off", () => {
  test("home proves Search without sign-in", async ({ page }) => {
    await runHomeFirstProof(page);
  });

  test("cockpit loads demo pack and completes search without sign-in", async ({ page }) => {
    await runCockpitDemoSearch(page);
  });

  test("create route stays open without sign-in", async ({ page }) => {
    await assertNoAuthRedirect(page, "/create");
    await page.getByRole("heading", { name: "What are you working with?" }).waitFor();
  });
});

test.describe("@auth-on", () => {
  test("home proves Search without sign-in when auth is enabled", async ({ page }) => {
    await runHomeFirstProof(page);
  });

  test("cockpit loads demo pack and completes search when auth is enabled", async ({ page }) => {
    await runCockpitDemoSearch(page);
  });

  test("create route stays open when auth is enabled", async ({ page }) => {
    await assertNoAuthRedirect(page, "/create");
    await page.getByRole("heading", { name: "What are you working with?" }).waitFor();
  });
});
