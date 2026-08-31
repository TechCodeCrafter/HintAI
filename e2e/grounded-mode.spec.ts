import { expect, test } from "@playwright/test";
import { mockLLM, openCockpit, setMode, typeQuestion, waitForCard } from "./fixtures/helpers";

test("From my docs shows a spoken answer and opens the cited file", async ({ page }) => {
  await openCockpit(page);
  await mockLLM(page, "We stop at three retries so a fourth attempt does not duplicate the file.");
  await setMode(page, "docs");
  await typeQuestion(page, "Why does that retry three times?");

  const card = await waitForCard(page, { badge: "From your docs" });
  const cite = card.getByTestId("card-citation").filter({ hasText: "src/exporter/retry.ts" });
  await expect(cite).toBeVisible();

  await cite.click();
  await expect(page.getByTestId("file-viewer")).toContainText("MAX_ATTEMPTS");
});
