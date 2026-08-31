import { expect, type Locator, type Page } from "@playwright/test";
import { installE2eMocks, mockLLM } from "./mocks";

export { installE2eMocks, injectUtterance, mockLLM } from "./mocks";

export async function openCockpit(page: Page) {
  await installE2eMocks(page);
  await page.goto("/app");
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", {
    timeout: 20000,
  });
}

export async function setMode(page: Page, mode: "grounded" | "polished" | "assisted") {
  await page.getByTestId(`mode-${mode}`).click();
}

export async function typeQuestion(page: Page, text: string) {
  const input = page.getByTestId("search-input");
  await input.fill(text);
  await input.press("Enter");
}

export async function waitForCard(
  page: Page,
  opts?: { badge?: string; allowNull?: boolean },
): Promise<Locator> {
  const card = page.getByTestId("card");
  await card.waitFor({ timeout: 15000 });
  if (opts?.allowNull === false || opts?.badge) {
    await expect(card.getByTestId("card-say")).toBeVisible({ timeout: 15000 });
    await expect(card.getByTestId("card-say")).not.toBeEmpty();
  }
  if (opts?.badge) {
    await expect(card.getByTestId("card-badge")).toHaveText(opts.badge, {
      ignoreCase: true,
      timeout: 15000,
    });
  }
  return card;
}

export async function waitForIndexing(page: Page) {
  await page.getByTestId("indexing-complete").waitFor({ timeout: 60000 });
}
