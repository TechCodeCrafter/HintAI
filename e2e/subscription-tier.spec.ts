import { expect, test } from "@playwright/test";
import { openCockpit, typeQuestion } from "./fixtures/helpers";

test("free locks Synthesize and Audit; Extract Search still cites", async ({ page }) => {
  await openCockpit(page);

  const selector = page.getByTestId("mode-selector");
  await expect(selector.getByTestId("mode-extract")).toBeVisible();
  await expect(selector.getByTestId("mode-synthesize")).toHaveAttribute("data-locked", "true");
  await expect(selector.getByTestId("mode-audit")).toHaveAttribute("data-locked", "true");

  await selector.getByTestId("mode-synthesize").click();
  await expect(page.getByTestId("upgrade-prompt")).toContainText("Synthesize mode requires Pro");
  await expect(selector.getByTestId("mode-extract")).toHaveAttribute("aria-pressed", "true");

  await page.evaluate(() => {
    const store = window.useMeetHint?.getState();
    store?.setSubscription?.("free");
    (store as { setComposeMode?: (mode: "extract" | "synthesize" | "audit") => void }).setComposeMode?.(
      "synthesize",
    );
  });
  await typeQuestion(page, "Why does that retry three times?");
  await expect(page.getByTestId("card-reason")).toContainText("Synthesize mode requires Pro");

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
