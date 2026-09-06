import { expect, test } from "@playwright/test";
import { openCockpit, typeQuestion, waitForCard } from "./fixtures/helpers";

test("clicking a file citation paints and scrolls the full range", async ({ page }) => {
  await openCockpit(page);
  await typeQuestion(page, "Why does that retry three times?");

  const card = await waitForCard(page, { badge: "From your files" });
  const cite = card.getByTestId("card-citation").filter({ hasText: "src/exporter/retry.ts:4-6" });
  await expect(cite).toBeVisible();

  const viewer = page.getByTestId("file-viewer").locator("pre");
  await viewer.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator('[data-line="4"]')).not.toBeInViewport();

  await cite.click();

  for (const n of [4, 5, 6]) {
    const line = page.locator(`[data-line="${n}"]`);
    await expect(line).toHaveAttribute("data-cited", "true");
    await expect(line).toBeInViewport();
  }
  await expect(page.locator('[data-line="3"]')).not.toHaveAttribute("data-cited", "true");
  await expect(page.locator('[data-line="7"]')).not.toHaveAttribute("data-cited", "true");
});
