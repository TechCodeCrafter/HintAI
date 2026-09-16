import { expect, type Page } from "@playwright/test";

export type E2eUser = {
  email: string;
  password: string;
  name: string;
};

const AUTH_ROUTES = /\/(login|sign-in|auth\/)/;

export function expectProtectedRedirect(page: Page) {
  return expect(page).toHaveURL(AUTH_ROUTES);
}

/** Email sign-in via the E2E login form (MEETHINT_E2E=1 enables email/password on server). */
export async function e2eSignIn(page: Page, user: E2eUser) {
  await page.goto("/login");
  if (await page.getByTitle(user.name).isVisible().catch(() => false)) {
    await page.goto("/home");
    return;
  }
  await expect(page.getByTestId("login-page")).toBeVisible();
  const form = page.getByTestId("login-email-form");
  await expect(form).toBeVisible();

  await page.getByText("Need an account? Sign up").click();
  await page.getByTestId("login-name").fill(user.name);
  await page.getByTestId("login-email").fill(user.email);
  await page.getByTestId("login-password").fill(user.password);
  await page.getByTestId("login-email-submit").click();

  const signedIn = page.waitForURL(/\/home/, { timeout: 15000 }).then(() => true).catch(() => false);
  if (!(await signedIn)) {
    await page.getByText("Already have an account? Sign in").click();
    await page.getByTestId("login-email").fill(user.email);
    await page.getByTestId("login-password").fill(user.password);
    await page.getByTestId("login-email-submit").click();
    await page.waitForURL(/\/home/, { timeout: 15000 });
  }

  await expect(page.getByTitle(user.name)).toBeVisible({ timeout: 15000 });
}

export async function e2eSignOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
  await expect(page.getByTestId("login-page")).toBeVisible();
}

export const USER_A: E2eUser = {
  email: "user-a@e2e.meethint.test",
  password: "E2e-User-A-92817!",
  name: "User A",
};

export const USER_B: E2eUser = {
  email: "user-b@e2e.meethint.test",
  password: "E2e-User-B-92817!",
  name: "User B",
};
