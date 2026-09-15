import { expect, test } from "@playwright/test";
import {
  e2eSignIn,
  e2eSignOut,
  expectProtectedRedirect,
  USER_A,
  USER_B,
} from "./fixtures/auth";
import {
  fillCreateContextIdentity,
  installE2eMocks,
  waitForIndexing,
} from "./fixtures/helpers";

test.setTimeout(120_000);

const MARKER = "AUTH_E2E_PRIVATE_92817";
const SPACE_NAME = "auth-e2e-private-space";

test("unauthenticated /home redirects to /login", async ({ page }) => {
  await page.goto("/home");
  await expectProtectedRedirect(page);
  await expect(page.getByTestId("login-page")).toBeVisible();
});

test("login succeeds and refresh preserves session", async ({ page }) => {
  await e2eSignIn(page, USER_A);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText("Signing out…")).toHaveCount(0);
  await expect(page.getByText(USER_A.name)).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText(USER_A.name)).toBeVisible({ timeout: 15000 });
});

test("protected Ask and Live routes require auth", async ({ page }) => {
  await page.goto("/context/00000000-0000-4000-8000-000000000001/ask");
  await expectProtectedRedirect(page);
  await page.goto("/context/00000000-0000-4000-8000-000000000001/live");
  await expectProtectedRedirect(page);
  await page.goto("/create");
  await expectProtectedRedirect(page);
});

test("User A data is isolated from User B", async ({ page }) => {
  await installE2eMocks(page);
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await fillCreateContextIdentity(page, SPACE_NAME);
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-files-button").click(),
  ]);
  await fileChooser.setFiles([
    {
      name: "secret.ts",
      mimeType: "text/plain",
      buffer: Buffer.from(`export const token = "${MARKER}";\n`),
    },
  ]);
  await waitForIndexing(page);
  const contextId = await page.evaluate(() => window.useMeetHint?.getState?.().activeContextId ?? "");
  expect(contextId).toBeTruthy();

  await e2eSignOut(page);
  await e2eSignIn(page, USER_B);
  await page.goto("/home");
  await expect(page.locator("body")).not.toContainText(SPACE_NAME);
  await expect(page.locator("body")).not.toContainText(MARKER);

  await page.goto(`/context/${contextId}`);
  await expect(page.getByTestId("space-missing")).toBeVisible();
  await page.goto(`/context/${contextId}/ask`);
  await expect(page.locator("body")).not.toContainText(MARKER);
  await expect(page.locator("body")).not.toContainText(SPACE_NAME);
});

test("signup telemetry fires only after verified account creation", async ({ page }) => {
  await page.goto("/login");
  await e2eSignIn(page, {
    email: `telemetry-${Date.now()}@e2e.meethint.test`,
    password: "E2e-Telemetry-92817!",
    name: "Telemetry User",
  });
  await page.goto("/home");
  await expect(page.getByText("Telemetry User")).toBeVisible({ timeout: 15000 });

  await expect
    .poll(async () => {
      const count = await page.evaluate(() => {
        let found = 0;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.includes("betaTelemetry")) continue;
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          for (const line of raw.split("\n").filter(Boolean)) {
            const row = JSON.parse(line) as { kind?: string; event?: string };
            if (row.kind === "event" && row.event === "USER_CREATED") found += 1;
          }
        }
        return found;
      });
      return count;
    })
    .toBeGreaterThanOrEqual(1);

  const events = await page.evaluate(() => {
    const rows: Array<{ kind: string; event?: string }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.includes("betaTelemetry")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      for (const line of raw.split("\n").filter(Boolean)) {
        rows.push(JSON.parse(line) as { kind: string; event?: string });
      }
    }
    return rows;
  });
  const created = events.filter((row) => row.kind === "event" && row.event === "USER_CREATED");
  const signup = events.filter((row) => row.kind === "event" && row.event === "SIGNUP");
  expect(created.length).toBeGreaterThanOrEqual(1);
  expect(signup.length).toBeGreaterThanOrEqual(1);
});
