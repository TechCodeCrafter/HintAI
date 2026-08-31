import { expect, test } from "@playwright/test";
import { mockLLM, openCockpit, setMode, typeQuestion, waitForCard } from "./fixtures/helpers";

test.describe("Answer from docs or freely", () => {
  test("From my docs: spoken answer plus citation", async ({ page }) => {
    await openCockpit(page);
    await mockLLM(page, "We stop at three retries so a fourth attempt does not duplicate the file.");
    await setMode(page, "docs");
    await typeQuestion(page, "Why does that retry three times?");
    const card = await waitForCard(page, { badge: "From your docs" });
    await expect(card.getByTestId("card-say")).toContainText("three");
    await expect(card.getByTestId("card-citation").filter({ hasText: "src/exporter/retry" })).toBeVisible();
  });

  test("weather is generated with no citation", async ({ page }) => {
    await openCockpit(page);
    await mockLLM(page, "I don't have live weather here, so I would check a forecast before answering.");
    await setMode(page, "docs");
    await typeQuestion(page, "What is the weather today?");
    const card = await waitForCard(page, { badge: "Generated" });
    await expect(card.getByTestId("card-citation")).toHaveCount(0);
  });

  test("Freely never cites", async ({ page }) => {
    await openCockpit(page);
    await mockLLM(page, "Retries usually stop after a few attempts so a later try does not double-send.");
    await setMode(page, "free");
    await typeQuestion(page, "Why does that retry three times?");
    const card = await waitForCard(page, { badge: "Generated" });
    await expect(card.getByTestId("card-citation")).toHaveCount(0);
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
    await mockLLM(page, "We stop at three retries so a fourth attempt does not duplicate the file.");
    await setMode(page, "docs");
    await typeQuestion(page, "Why does that retry three times?");
    const card = await waitForCard(page, { allowNull: false });
    await expect(card.getByTestId("card-say")).toContainText("three");

    await mockLLM(page, "I would check a forecast rather than guess the weather.");
    await typeQuestion(page, "What is the weather in Paris today?");
    await expect(card.getByTestId("card-say")).toContainText("forecast");
    await expect(card.getByTestId("card-say")).not.toContainText("duplicate the file");
    await expect(card.getByTestId("card-badge")).toHaveText("Generated", { ignoreCase: true });
  });
});
