import { expect, test } from "@playwright/test";
import { openCockpit, setMode, typeQuestion, waitForCard } from "./fixtures/helpers";

test("Grounded mode shows exact citation", async ({ page }) => {
  await openCockpit(page);
  await setMode(page, "grounded");
  await typeQuestion(page, "Why does that retry three times?");

  const card = await waitForCard(page, { badge: "From your docs" });
  await expect(card.getByTestId("card-citation")).toContainText("src/exporter/retry.ts");

  const citationText = await card.getByTestId("card-citation").textContent();
  const lineMatch = citationText?.match(/:(\d+)(?:-\d+)?/);
  expect(lineMatch).toBeTruthy();
  const lineNum = Number(lineMatch![1]);
  expect(lineNum).toBeGreaterThan(1);

  await card.getByTestId("card-citation").click();
  await expect(page.getByTestId("file-viewer")).toContainText("MAX_ATTEMPTS");
});
