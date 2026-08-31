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

  test("mode buttons explain what each one is for", async ({ page }) => {
    await openCockpit(page);
    await page.getByTestId("mode-grounded").hover();
    await expect(page.getByTestId("mode-grounded-tip")).toContainText("proof");
    await expect(page.getByTestId("mode-grounded-tip")).toContainText("silent");
  });

  test("mode buttons persist the chosen mode", async ({ page }) => {
    await openCockpit(page);
    await setMode(page, "assisted");
    await expect(page.getByTestId("mode-assisted")).toHaveAttribute("data-active", "true");
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("ground.answerMode")))
      .toBe("assisted");
    await setMode(page, "grounded");
    await expect(page.getByTestId("mode-grounded")).toHaveAttribute("data-active", "true");
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("ground.answerMode")))
      .toBe("grounded");
  });

  test("silence replaces the previous answer instead of stacking it", async ({ page }) => {
    await openCockpit(page);
    await setMode(page, "grounded");
    await typeQuestion(page, "Why does that retry three times?");
    const card = await waitForCard(page, { allowNull: false });
    await expect(card.getByTestId("card-say")).toContainText("three");

    await typeQuestion(page, "What is the weather in Paris today?");
    await expect(card.getByTestId("card-reason")).toBeVisible();
    await expect(card.getByTestId("card-say")).toHaveCount(0);
    await expect(card.getByTestId("card-reason")).toHaveText("Nothing in this pack cites that.");
    await expect(card).not.toContainText("MAX_ATTEMPTS");
    await expect(card).not.toContainText("payment gateway");
  });
});
