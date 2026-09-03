import { expect, test } from "@playwright/test";
import { openCockpit, typeQuestion } from "./fixtures/helpers";

test("free locks Synthesize and Audit; Extract Search still cites", async ({ page }) => {
  await openCockpit(page);

  const selector = page.getByTestId("mode-selector");
  await expect(selector.getByTestId("mode-extract")).toBeVisible();
  await expect(selector.getByTestId("mode-synthesize")).toHaveAttribute("data-locked", "true");
  await expect(selector.getByTestId("mode-audit")).toHaveAttribute("data-locked", "true");

  await selector.getByTestId("mode-synthesize").click();
  const modal = page.getByTestId("upgrade-modal");
  await expect(modal).toBeVisible();
  await expect(page.getByTestId("upgrade-prompt")).toContainText("Synthesize mode requires Pro");
  await expect(modal.getByTestId("upgrade-cta")).toHaveText("Get early access");
  await modal.getByTestId("upgrade-email").fill("demo@meethint.ai");
  await modal.getByTestId("upgrade-cta").click();
  await expect(page.getByTestId("upgrade-waitlist-done")).toHaveText("Thanks, you're on the list");
  await expect(selector.getByTestId("mode-extract")).toHaveAttribute("aria-pressed", "true");
  await modal.getByTestId("upgrade-close").click();
  await expect(modal).toHaveCount(0);

  await selector.getByTestId("mode-audit").click();
  await expect(page.getByTestId("upgrade-prompt")).toContainText("Claim Audit requires Pro");
  await page.getByTestId("upgrade-close").click();

  await page.evaluate(() => {
    const store = window.useMeetHint?.getState();
    store?.setSubscription?.("free");
    (store as { setComposeMode?: (mode: "extract" | "synthesize" | "audit") => void }).setComposeMode?.(
      "synthesize",
    );
  });
  await typeQuestion(page, "Why does that retry three times?");
  await expect(page.getByTestId("card-reason")).toContainText("Synthesize mode requires Pro");

  await page.evaluate(() => {
    window.useMeetHint?.getState().setSubscription?.("pro");
  });
  await selector.getByTestId("mode-synthesize").click();
  await expect(page.getByTestId("upgrade-modal")).toHaveCount(0);
  await expect(selector.getByTestId("mode-synthesize")).toHaveAttribute("aria-pressed", "true");
  await selector.getByTestId("mode-extract").click();

  await page.evaluate(async () => {
    const store = window.useMeetHint?.getState() as {
      setSubscription: (tier: "free") => void;
      startClaimAudit: () => Promise<void>;
    };
    store.setSubscription("free");
    await store.startClaimAudit();
  });
  await expect(page.getByTestId("claim-monitor")).toHaveCount(0);
});
