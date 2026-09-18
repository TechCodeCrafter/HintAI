import { expect, test } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { fillCreateContextIdentity, installE2eMocks, openCockpit, typeQuestion, waitForCard } from "./fixtures/helpers";
import { mockLLM } from "./fixtures/mocks";

const OUT = "artifacts/ui-redesign";

test.describe("UI redesign screenshots", () => {
  test("capture marketing and app surfaces", async ({ page }) => {
    test.setTimeout(180_000);
    await installE2eMocks(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Know the answer/ })).toBeVisible();
    await page.screenshot({ path: `${OUT}/landing-desktop.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Know the answer/ })).toBeVisible();
    await page.screenshot({ path: `${OUT}/landing-mobile.png`, fullPage: true });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await expect(page.getByTestId("login-page")).toBeVisible();
    await page.screenshot({ path: `${OUT}/login.png`, fullPage: true });

    await e2eSignIn(page, USER_A);
    await page.goto("/home");
    await expect(page.getByTestId("home-proof")).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: `${OUT}/home.png`, fullPage: true });

    await page.goto("/create");
    await expect(page.getByRole("heading", { name: "Create a knowledge space." })).toBeVisible();
    await page.screenshot({ path: `${OUT}/create.png`, fullPage: true });

    await fillCreateContextIdentity(page, "Screenshot Space");
    await expect(page.getByRole("heading", { name: "Add material" })).toBeVisible();
    await page.screenshot({ path: `${OUT}/add-material.png`, fullPage: true });

    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("upload-files-button").click(),
    ]);
    await chooser.setFiles([
      {
        name: "notes.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Architecture\n\nThe app uses a three-pane cockpit.\n"),
      },
    ]);
    await page.getByTestId("indexing-complete").waitFor({ timeout: 60000 });
    await page.getByTestId("indexing-done").click();
    await expect(page.getByTestId("space-detail")).toBeVisible();
    await page.screenshot({ path: `${OUT}/knowledge-space.png`, fullPage: true });

    await page.getByTestId("start-live").click();
    await expect(page.getByTestId("cockpit")).toBeVisible();
    await page.screenshot({ path: `${OUT}/live-idle.png`, fullPage: true });

    await mockLLM(page, "The app uses a three-pane cockpit. [1]");
    await typeQuestion(page, "What is the architecture?");
    const card = await waitForCard(page, { allowNull: false });
    await expect(card.getByTestId("card-say")).toContainText("cockpit");
    await page.screenshot({ path: `${OUT}/live-supported-answer.png`, fullPage: true });

    await typeQuestion(page, "What is the weather today?");
    await expect(page.getByTestId("card-reason")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("card-say")).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/live-unsupported-answer.png`, fullPage: true });
  });
});
