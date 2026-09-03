import { expect, test } from "@playwright/test";
import { injectUtterance, openCockpit } from "./fixtures/helpers";

test("free chrome stays complete and Room stays readable", async ({ page }) => {
  await openCockpit(page);

  await page.evaluate(async () => {
    const store = window.useMeetHint?.getState() as {
      setSubscription: (tier: "free") => void;
      startClaimAudit: () => Promise<void>;
    };
    store.setSubscription("free");
    await store.startClaimAudit();
  });
  await expect(page.locator(".cockpit-note")).not.toContainText("Claim Audit requires Pro");
  await expect(page.getByText("YOU SAY")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Paste question" })).toBeVisible();

  const long =
    "Can you tell me the architecture of this whole application and project? Can you tell me more of why you're using JavaScript over TypeScript? Alright, do you guys get money from this?";
  await injectUtterance(page, long);
  const turn = page.getByTestId("room-turn").first();
  await expect(turn).toContainText("They");
  await expect(turn.getByRole("button", { name: "Show more" })).toBeVisible();
  await turn.getByRole("button", { name: "Show more" }).click();
  await expect(turn.getByRole("button", { name: "Show less" })).toBeVisible();
  await expect(turn).toContainText("get money");

  await page.evaluate(() => {
    (
      window.useMeetHint?.getState() as { setAsrNote: (note: string) => void } | undefined
    )?.setAsrNote("Mic only — no shared tab, so your mic is carrying the room.");
  });
  const hint = page.getByTestId("listen-hint");
  await expect(hint).toContainText("Mic only");
  await expect(page.getByTestId("room-turn")).not.toContainText("Mic only");
  await hint.getByRole("button", { name: "Dismiss" }).click();
  await expect(hint).toHaveCount(0);
});
