import { expect, test } from "@playwright/test";
import { openCockpit, typeQuestion, waitForCard } from "./fixtures/helpers";

test("a cited card opens the file the line came from", async ({ page }) => {
  await openCockpit(page);
  await typeQuestion(page, "Why does that retry three times?");

  const card = await waitForCard(page, { badge: "From your files" });
  const cite = card.getByTestId("card-citation").filter({ hasText: "src/exporter/retry.ts" });
  await expect(cite).toBeVisible();

  await cite.click();
  await expect(page.getByTestId("file-viewer")).toContainText("MAX_ATTEMPTS");
});
