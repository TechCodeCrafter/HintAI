import { expect, test } from "@playwright/test";
import { mockLLM, openCockpit, setMode, typeQuestion, waitForCard } from "./fixtures/helpers";

test.describe("Three Answer Modes", () => {
  test("Grounded: no LLM call, exact citation", async ({ page }) => {
    await openCockpit(page);
    await setMode(page, "grounded");
    await typeQuestion(page, "What did we change in the exporter?");
    const card = await waitForCard(page, { badge: "From your docs" });
    await expect(card.getByTestId("card-citation")).toBeVisible();
  });

  test("Polished: LLM rewrites, same citation", async ({ page }) => {
    await openCockpit(page);
    await mockLLM(page, "We adjusted the exporter to handle larger payloads more gracefully.");
    await setMode(page, "polished");
    await typeQuestion(page, "What did we change in the exporter?");
    const card = await waitForCard(page, { badge: "Polished from your docs" });
    await expect(card.getByTestId("card-say")).toContainText("larger payloads");
    await expect(card.getByTestId("card-citation")).toContainText("src/exporter");
  });

  test("Assisted: LLM fallback when evidence silent, no citation", async ({ page }) => {
    await openCockpit(page);
    await mockLLM(page, "Exporters typically transform records before they leave the system.");
    await setMode(page, "assisted");
    await typeQuestion(page, "What is the weather today?");
    const card = await waitForCard(page, { badge: "Suggested" });
    await expect(card.getByTestId("card-citation")).toHaveCount(0);
  });

  test("Assisted: uses evidence when available, shows grounded badge", async ({ page }) => {
    await openCockpit(page);
    await setMode(page, "assisted");
    await typeQuestion(page, "Why does that retry three times?");
    const card = await waitForCard(page, { badge: "From your docs" });
    await expect(card.getByTestId("card-citation")).toBeVisible();
  });
});
