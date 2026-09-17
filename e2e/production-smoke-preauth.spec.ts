import { expect, test } from "@playwright/test";

import { PRODUCTION_URL, expectProtectedRedirect } from "./fixtures/production-smoke-shared";

test.describe("production smoke — logged out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated /home redirects to /login", async ({ page }) => {
    await page.goto("/home");
    await expectProtectedRedirect(page);
    await expect(page.getByTestId("login-page")).toBeVisible({ timeout: 20_000 });
  });

  test("public /login is reachable", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-page")).toBeVisible();
  });

  test("auth status reports OAuth ready on production host", async ({ request }) => {
    const res = await request.get(`${PRODUCTION_URL}/api/auth/status`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { oauthReady?: boolean; googleDirect?: boolean };
    expect(body.oauthReady).toBe(true);
    expect(body.googleDirect).toBe(true);
  });

  test("get-session is null without cookies", async ({ request }) => {
    const res = await request.get(`${PRODUCTION_URL}/api/auth/get-session`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body?.user?.id).toBeUndefined();
  });
});
