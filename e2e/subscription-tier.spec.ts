import { expect, test } from "@playwright/test";
import { openCockpit, typeQuestion } from "./fixtures/helpers";

test("free chrome has no mode tabs; Audit opens the waitlist", async ({ page }) => {
  await openCockpit(page);

  await expect(page.getByTestId("mode-selector")).toHaveCount(0);
  await expect(page.getByTestId("mode-extract")).toHaveCount(0);
  await expect(page.getByTestId("mode-synthesize")).toHaveCount(0);
  await expect(page.getByTestId("mode-audit")).toHaveCount(0);

  await page.getByTestId("audit-meeting").click();
  const modal = page.getByTestId("upgrade-modal");
  await expect(modal).toBeVisible();
  await expect(page.getByTestId("upgrade-prompt")).toContainText("Claim Audit requires Pro");
  await expect(modal.getByTestId("upgrade-cta")).toHaveText("Get early access");
  await modal.getByTestId("upgrade-email").fill("demo@meethint.ai");
  await modal.getByTestId("upgrade-cta").click();
  await expect(page.getByTestId("upgrade-waitlist-done")).toHaveText("Thanks, you're on the list");
  await modal.getByTestId("upgrade-close").click();
  await expect(modal).toHaveCount(0);

  await page.evaluate(() => {
    window.useMeetHint?.getState().setSubscription?.("pro");
  });
  await page.getByTestId("audit-meeting").click();
  await expect(page.getByTestId("upgrade-modal")).toHaveCount(0);
  await expect(page.getByTestId("claim-monitor")).toBeVisible();

  await page.evaluate(() => {
    window.useMeetHint?.getState().setSubscription?.("free");
  });
  await typeQuestion(page, "Why does that retry three times?");
  await expect(page.getByTestId("card-say")).toBeVisible();
});
