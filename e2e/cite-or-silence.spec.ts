import { expect, test } from "@playwright/test";
import { openCockpit, typeQuestion, waitForCard } from "./fixtures/helpers";

test.describe("Cite or stay silent", () => {
  test("a covered question speaks a cited line", async ({ page }) => {
    await openCockpit(page);
    await typeQuestion(page, "Why does that retry three times?");
    const card = await waitForCard(page, { badge: "From your docs" });
    await expect(card.getByTestId("card-say")).toContainText("three");
    await expect(card.getByTestId("card-citation").filter({ hasText: "src/exporter/retry" })).toBeVisible();
  });

  test("weather is not cited from the files", async ({ page }) => {
    await openCockpit(page);
    await typeQuestion(page, "What is the weather today?");
    const card = await waitForCard(page, { badge: "Generated" });
    await expect(card.getByTestId("card-say")).not.toBeEmpty();
    await expect(card.getByTestId("card-citation")).toHaveCount(0);
  });

  test("an off-topic question does not keep the previous citation", async ({ page }) => {
    await openCockpit(page);
    await typeQuestion(page, "Why does that retry three times?");
    const card = await waitForCard(page, { allowNull: false });
    await expect(card.getByTestId("card-say")).toContainText("three");

    await typeQuestion(page, "What is the weather in Paris today?");
    await expect(card.getByTestId("card-citation").filter({ hasText: "src/exporter/retry" })).toHaveCount(0);
  });

  test("the cockpit does not offer a generate toggle or model picker", async ({ page }) => {
    await openCockpit(page);
    await expect(page.getByTestId("mode-docs")).toHaveCount(0);
    await expect(page.getByTestId("mode-free")).toHaveCount(0);
    await expect(page.getByTestId("model-selector")).toHaveCount(0);
  });
});
