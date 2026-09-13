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

/** Sync a React controlled input — fill() alone can race hydration in CI. */
export async function fillControlledInput(locator: Locator, value: string) {
  await locator.click();
  await locator.fill(value);
  await locator.evaluate((el, next) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

/** Pick a context kind and name, then continue to Add material. Retries until React has hydrated. */
export async function fillCreateContextIdentity(
  page: Page,
  name: string,
  kind = "work",
) {
  const kindButton = page.getByTestId(`context-type-${kind}`);
  const nameInput = page.getByTestId("context-name");
  const submit = page.getByTestId("create-context-submit");
  await expect(kindButton).toBeVisible();
  await expect(async () => {
    await kindButton.click();
    await expect(kindButton).toHaveClass(/border-accent/);
    await fillControlledInput(nameInput, name);
    await expect(submit).toBeEnabled();
  }).toPass({ timeout: 15000 });
  await submit.click();
  await page.getByRole("heading", { name: "Add material" }).waitFor();
}
