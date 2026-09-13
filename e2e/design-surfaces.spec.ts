import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openCockpit } from "./fixtures/helpers";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const SNAPSHOT_OPTS = {
  maxDiffPixelRatio: 0.05,
  animations: "disabled" as const,
};

/** Rules this loop gates on — contrast, touch targets, heading structure, keyboard scroll. */
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

for (const viewport of VIEWPORTS) {
  test(`landing @ ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Know the answer/ })).toBeVisible();
    await expect(page).toHaveScreenshot(`landing-${viewport.name}.png`, SNAPSHOT_OPTS);
    await scanA11y(page, `landing ${viewport.name}`, {
      exclude: "#demo, .hint-landing > section:first-of-type .overflow-hidden",
    });
  });

  test(`cockpit @ ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openCockpit(page);
    await expect(page.getByTestId("cockpit")).toBeVisible();
    await expect(page).toHaveScreenshot(`cockpit-${viewport.name}.png`, SNAPSHOT_OPTS);
    await scanA11y(page, `cockpit ${viewport.name}`);
  });
}
