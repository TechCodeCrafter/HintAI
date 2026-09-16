import { expect, test } from "@playwright/test";
import { e2eSignIn, e2eSignOut, USER_A, USER_B } from "./fixtures/auth";
import { installE2eMocks } from "./fixtures/helpers";
import { countSignupTelemetry, funnelUserCreatedTimestamp } from "./fixtures/telemetry";

test.setTimeout(120_000);

test("beta gate: signup telemetry only for verified authenticated accounts", async ({ page }) => {
  await installE2eMocks(page);

  await page.goto("/login");
  await expect(page.getByTestId("login-page")).toBeVisible();
  let counts = await countSignupTelemetry(page);
  expect(counts.USER_CREATED).toBe(0);
  expect(counts.SIGNUP).toBe(0);

  await page.reload();
  await expect(page.getByTestId("login-page")).toBeVisible();
  counts = await countSignupTelemetry(page);
  expect(counts.USER_CREATED).toBe(0);
  expect(counts.SIGNUP).toBe(0);

  await page.goto("/home");
  await expect(page.getByTestId("login-page")).toBeVisible();
  counts = await countSignupTelemetry(page);
  expect(counts.USER_CREATED).toBe(0);
  expect(counts.SIGNUP).toBe(0);

  await e2eSignIn(page, USER_A);
  await page.goto("/home");
  await expect(page.getByTestId("beta-onboarding")).toBeVisible();
  await expect(page.getByTestId("beta-onboarding-sign-in")).toHaveAttribute("data-complete", "true");

  await expect
    .poll(async () => {
      const next = await countSignupTelemetry(page);
      return next.USER_CREATED === 1 && next.SIGNUP === 1;
    })
    .toBe(true);

  const ttfaStartBeforeRefresh = await funnelUserCreatedTimestamp(page);
  expect(ttfaStartBeforeRefresh).not.toBeNull();

  await page.reload();
  await expect(page.getByTitle(USER_A.name)).toBeVisible({ timeout: 15000 });
  counts = await countSignupTelemetry(page);
  expect(counts.USER_CREATED).toBe(1);
  expect(counts.SIGNUP).toBe(1);
  expect(await funnelUserCreatedTimestamp(page)).toBe(ttfaStartBeforeRefresh);

  await e2eSignOut(page);
  await e2eSignIn(page, USER_A);
  await page.goto("/home");
  await expect(page.getByTitle(USER_A.name)).toBeVisible({ timeout: 15000 });
  counts = await countSignupTelemetry(page);
  expect(counts.USER_CREATED).toBe(1);
  expect(counts.SIGNUP).toBe(1);

  await e2eSignOut(page);
  await e2eSignIn(page, USER_B);
  await page.goto("/home");
  await expect(page.getByTitle(USER_B.name)).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("beta-onboarding-sign-in")).toHaveAttribute("data-complete", "true");

  await expect
    .poll(async () => {
      const next = await countSignupTelemetry(page);
      return next.USER_CREATED === 2 && next.SIGNUP === 2;
    })
    .toBe(true);
});
