import { expect, test } from "@playwright/test";
import {
  e2eSignIn,
  e2eSignOut,
  expectProtectedRedirect,
  USER_A,
} from "./fixtures/auth";
import { installE2eMocks } from "./fixtures/helpers";

test.setTimeout(120_000);

test("beta gate: auth-enabled preview exposes real auth config without dev-user fallback", async ({
  page,
  request,
}) => {
  await installE2eMocks(page);

  const status = await request.get("/api/auth/status");
  expect(status.ok()).toBe(true);
  const config = (await status.json()) as {
    authEnabled: boolean;
    authConfigured: boolean;
    emailPasswordEnabled: boolean;
    devUserFallbackBlocked: boolean;
    oauthReady: boolean;
    blockers: string[];
  };
  expect(config.authEnabled).toBe(true);
  expect(config.emailPasswordEnabled).toBe(true);
  expect(config.devUserFallbackBlocked).toBe(true);
  expect(config.oauthReady).toBe(true);
  expect(config.blockers).toEqual([]);
  expect(config.authConfigured || config.emailPasswordEnabled).toBe(true);

  const sessionBefore = await request.get("/api/auth/get-session");
  expect(sessionBefore.ok()).toBe(true);
  const bodyBefore = (await sessionBefore.json()) as { user?: { id?: string } } | null;
  expect(bodyBefore?.user?.id).not.toBe("dev-user");

  await page.goto("/login");
  await expect(page.getByTestId("login-page")).toBeVisible();

  for (const path of ["/home", "/app", "/create", "/context/00000000-0000-4000-8000-000000000001/ask", "/context/00000000-0000-4000-8000-000000000001/live"]) {
    await page.goto(path);
    await expectProtectedRedirect(page);
    await expect(page.getByTestId("login-page")).toBeVisible();
  }

  await e2eSignIn(page, USER_A);
  await page.goto("/home");
  await expect(page.getByTitle(USER_A.name)).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("beta-onboarding-sign-in")).toHaveAttribute("data-complete", "true");

  const bodyAfter = await page.evaluate(async () => {
    const res = await fetch("/api/auth/get-session", { credentials: "include" });
    return (await res.json()) as { user?: { id?: string; name?: string } } | null;
  });
  expect(bodyAfter?.user?.id).toBeTruthy();
  expect(bodyAfter?.user?.id).not.toBe("dev-user");
  expect(bodyAfter?.user?.name).toBe(USER_A.name);

  const vaultName = await page.evaluate((userId) => {
    const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "account";
    return `meethint.${sanitized}`;
  }, bodyAfter!.user!.id);
  await expect
    .poll(async () => {
      return page.evaluate(async (name) => {
        const dbs = await indexedDB.databases();
        return dbs.some((db) => db.name === name);
      }, vaultName);
    })
    .toBe(true);

  const storageKeys = await page.evaluate(() => [...Object.keys(localStorage)]);
  expect(storageKeys.some((key) => key.startsWith("meethint.") && !key.includes("dev-user"))).toBe(true);
  expect(storageKeys.some((key) => key === "meethint.betaTelemetry")).toBe(false);

  await page.reload();
  await expect(page.getByTitle(USER_A.name)).toBeVisible({ timeout: 15000 });

  await e2eSignOut(page);
  const bodyLoggedOut = await page.evaluate(async () => {
    const res = await fetch("/api/auth/get-session", { credentials: "include" });
    return (await res.json()) as { user?: { id?: string } } | null;
  });
  expect(bodyLoggedOut?.user?.id).toBeUndefined();

  await page.goto("/home");
  await expectProtectedRedirect(page);
});
