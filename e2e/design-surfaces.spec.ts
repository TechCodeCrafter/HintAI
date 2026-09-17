import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openCockpit } from "./fixtures/helpers";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

/** Rules this loop gates on: contrast, touch targets, heading structure, keyboard scroll. */
const AXE_RULE_IDS = new Set([
  "color-contrast",
  "target-size",
  "heading-order",
  "page-has-heading-one",
  "scrollable-region-focusable",
]);

async function scanA11y(
  page: import("@playwright/test").Page,
  label: string,
  opts?: { exclude?: string },
) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  if (opts?.exclude) builder = builder.exclude(opts.exclude);
  const results = await builder.analyze();
  const violations = results.violations.filter((v) => AXE_RULE_IDS.has(v.id));
  expect(violations, `${label} a11y violations`).toEqual([]);
}

async function expectNoPageOverflow(page: import("@playwright/test").Page, label: string) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document, `${label} should not horizontally overflow`).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function expectInteractiveTargetsInsideViewport(page: import("@playwright/test").Page, label: string) {
  const escaped = await page.locator("button:visible, a:visible, input:visible, textarea:visible").evaluateAll((nodes) => {
    const viewport = document.documentElement.clientWidth;
    return nodes
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { text: (node.textContent ?? "").trim().slice(0, 80), left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((rect) => rect.width > 0 && (rect.left < -1 || rect.right > viewport + 1));
  });
  expect(escaped, `${label} interactive controls should stay inside the viewport`).toEqual([]);
}

for (const viewport of VIEWPORTS) {
  test(`landing @ ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Know the answer/ })).toBeVisible();
    await expect(page.getByTestId("landing")).toBeVisible();
    await expectNoPageOverflow(page, `landing ${viewport.name}`);
    await expectInteractiveTargetsInsideViewport(page, `landing ${viewport.name}`);
    await scanA11y(page, `landing ${viewport.name}`, {
      exclude: "#demo, .hint-landing > section:first-of-type .overflow-hidden",
    });
  });

  test(`cockpit @ ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openCockpit(page);
    await expect(page.getByTestId("cockpit")).toBeVisible();
    await expectNoPageOverflow(page, `cockpit ${viewport.name}`);
    await expectInteractiveTargetsInsideViewport(page, `cockpit ${viewport.name}`);

    if (viewport.width < 1024) {
      await expect(page.getByRole("navigation", { name: "Cockpit panes" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Room" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Answer" })).toBeVisible();
    }

    await scanA11y(page, `cockpit ${viewport.name}`);
  });
}
