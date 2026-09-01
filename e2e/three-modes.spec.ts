import { expect, test } from "@playwright/test";
import { openCockpit, setMode, typeQuestion, waitForCard } from "./fixtures/helpers";

test.describe("Answer from docs or freely", () => {
  test("From my docs: spoken answer plus citation", async ({ page }) => {
    await openCockpit(page);
    await setMode(page, "docs");
    await typeQuestion(page, "Why does that retry three times?");
    const card = await waitForCard(page, { badge: "From your docs" });
    await expect(card.getByTestId("card-say")).toContainText("three");
    await expect(card.getByTestId("card-citation").filter({ hasText: "src/exporter/retry" })).toBeVisible();
  });

  test("weather stays silent instead of generating", async ({ page }) => {
    await openCockpit(page);
    await setMode(page, "docs");
    await typeQuestion(page, "What is the weather today?");
    const card = await waitForCard(page);
    await expect(card.getByTestId("card-say")).toHaveCount(0);
    await expect(card.getByTestId("card-reason")).toBeVisible();
  });

  test("Freely still cites when the files cover the question", async ({ page }) => {
    await openCockpit(page);
    await setMode(page, "free");
    await typeQuestion(page, "Why does that retry three times?");
    const card = await waitForCard(page, { allowNull: false });
    await expect(card.getByTestId("card-say")).toContainText("three");
    await expect(card.getByTestId("card-citation").filter({ hasText: "src/exporter/retry" })).toBeVisible();
  });

  test("mode buttons explain what each one is for", async ({ page }) => {
    await openCockpit(page);
    await page.getByTestId("mode-docs").hover();
    await expect(page.getByTestId("mode-docs-tip")).toContainText("Cites");
  });

  test("mode buttons persist the chosen mode", async ({ page }) => {
    await openCockpit(page);
    await setMode(page, "free");
    await expect(page.getByTestId("mode-free")).toHaveAttribute("data-active", "true");
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("ground.answerMode")))
      .toBe("free");
    await setMode(page, "docs");
    await expect(page.getByTestId("mode-docs")).toHaveAttribute("data-active", "true");
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("ground.answerMode")))
      .toBe("docs");
  });

  test("a new answer replaces the previous say", async ({ page }) => {
    await openCockpit(page);
    await setMode(page, "docs");
    await typeQuestion(page, "Why does that retry three times?");
    const card = await waitForCard(page, { allowNull: false });
    await expect(card.getByTestId("card-say")).toContainText("three");

    await typeQuestion(page, "What is the weather in Paris today?");
    await expect(card.getByTestId("card-say")).toHaveCount(0);
    await expect(card.getByTestId("card-reason")).toBeVisible();
  });
});
