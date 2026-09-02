import { expect, test } from "@playwright/test";
import { openCockpit, typeQuestion, waitForCard } from "./fixtures/helpers";

test("Listen admits claims without Search, and Search only updates the Card", async ({ page }) => {
  await openCockpit(page);
  await expect(page.getByTestId("claim-monitor")).toHaveCount(0);

  await page.evaluate(async () => {
    const store = window.useMeetHint?.getState() as {
      startClaimAudit: () => Promise<void>;
      heard: (event: { id: string; role: "you"; text: string }) => void;
      admitHeardClaim: (u: { id: string; at: number; speaker: string; role: "you"; text: string }) => Promise<void>;
      utterances: Array<{ id: string; at: number; speaker: string; role: "you" | "them" | "system"; text: string }>;
    };
    await store.startClaimAudit();
    store.heard({
      id: "claim-retry",
      role: "you",
      text: "Attempts are capped at three because the payment gateway stalls rather than failing fast",
    });
    const uttered = store.utterances.find((item) => item.id === "claim-retry");
    if (uttered) await store.admitHeardClaim(uttered);
  });

  const monitor = page.getByTestId("claim-monitor");
  await expect(monitor).toBeVisible();
  const row = monitor.getByTestId("claim-row");
  await expect(row).toContainText("capped at three");
  await expect(row).toHaveAttribute("data-status", "supported");
  await expect(row).toContainText(/retry\.ts|exporter-retries/);

  await typeQuestion(page, "Why does that retry three times?");
  const card = await waitForCard(page, { badge: "From your files" });
  await expect(card.getByTestId("card-say")).toContainText("three");
  await expect(monitor.getByTestId("claim-row")).toHaveCount(1);
  await expect(monitor.getByTestId("claim-row")).toContainText("capped at three");
  await expect(monitor.getByTestId("claim-row")).toHaveAttribute("data-status", "supported");

  await page.reload();
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", { timeout: 20000 });
  await expect(page.getByTestId("claim-monitor").getByTestId("claim-row")).toContainText("capped at three");
});
