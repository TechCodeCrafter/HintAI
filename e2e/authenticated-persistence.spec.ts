import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium, expect, test } from "@playwright/test";

import { E2E_PREVIEW_URL } from "../scripts/e2e-preview-shared.mjs";
import { e2eSignIn, e2eSignOut, USER_A, USER_B } from "./fixtures/auth";
import { installE2eMocks } from "./fixtures/helpers";
import {
  createIndexedSpace,
  expectSpacePersisted,
  expectTenantEmpty,
  verifyRefreshRecovery,
} from "./fixtures/persistence";

test.setTimeout(240_000);

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? E2E_PREVIEW_URL;

test("beta gate: authenticated workspace persists across logout, account switch, and refresh", async ({
  page,
}) => {
  const { spaceId } = await createIndexedSpace(page, USER_A);

  // Scenario A — same user logout/login
  await e2eSignOut(page);
  await e2eSignIn(page, USER_A);
  await expectSpacePersisted(page, spaceId);

  // Scenario B — account switch, then A returns
  await e2eSignOut(page);
  await e2eSignIn(page, USER_B);
  await expectTenantEmpty(page, spaceId);

  await e2eSignOut(page);
  await e2eSignIn(page, USER_A);
  await expectSpacePersisted(page, spaceId);

  // Scenario D — refresh on home, Ask, Live
  await verifyRefreshRecovery(page, spaceId);
});

test("beta gate: authenticated workspace survives browser restart on the same profile", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meethint-persist-"));
  let spaceId = "";

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      baseURL,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    ({ spaceId } = await createIndexedSpace(page, USER_A));
    await context.close();

    const restarted = await chromium.launchPersistentContext(userDataDir, {
      baseURL,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page2 = await restarted.newPage();
    await installE2eMocks(page2);
    await page2.goto("/home");
    if (await page2.getByTestId("login-page").isVisible().catch(() => false)) {
      await e2eSignIn(page2, USER_A);
    } else {
      await expect(page2.getByTitle(USER_A.name)).toBeVisible({ timeout: 15000 });
    }
    await expectSpacePersisted(page2, spaceId);
    await restarted.close();
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
