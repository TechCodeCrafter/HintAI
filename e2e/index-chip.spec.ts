import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { fillCreateContextIdentity, installE2eMocks, openCockpit, waitForIndexing } from "./fixtures/helpers";

type StoreView = {
  chunks: unknown[];
  togglePackExclusion: (path: string) => Promise<void> | void;
  setOverlay: (value: boolean) => void;
};

function store<T>(page: Page, read: (state: StoreView) => T): Promise<T> {
  return page.evaluate(
    (source) => new Function("state", `return (${source})(state)`)(window.useMeetHint?.getState()) as T,
    read.toString(),
  );
}

const chunkCount = (page: Page) => store(page, (state) => state.chunks.length);

/** The chip's whole line fits: nothing is cut off with an ellipsis. */
async function expectNotClipped(page: Page) {
  const text = page.getByTestId("index-chip-text");
  const box = await text.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(box.scroll).toBeLessThanOrEqual(box.client);
}

test("the chip is in the header with the counts search runs over, and opens to the index status", async ({ page }) => {
  await openCockpit(page);
  const chip = page.getByTestId("index-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("data-state", "ready");

  const chunks = await chunkCount(page);
  expect(chunks).toBeGreaterThan(0);
  await expect(page.getByTestId("index-chip-text")).toHaveText(
    new RegExp(`^Indexed \\d+ files · 0 skipped · ${chunks.toLocaleString("en-US")} chunks$`),
  );
  // The header is the cockpit's own bar, above the panes.
  await expect(page.locator("header.cockpit-glass-bar").getByTestId("index-chip")).toBeVisible();
  await expectNotClipped(page);

  await expect(page.getByTestId("index-chip-panel")).toHaveCount(0);
  await chip.click();
  const panel = page.getByTestId("index-chip-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("index-chip-complete")).toHaveText(
    "No skipped files on record. Every stored file is searchable.",
  );
  await expect(panel.getByTestId("index-chip-skipped")).toHaveCount(0);

  // The panel stays inside the window.
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(chip).toBeFocused();
  await chip.click();
  await expect(panel).toBeVisible();
  await page.getByTestId("search-input").click();
  await expect(panel).toHaveCount(0);
});

test("the chip follows the index: a file taken out of search is counted and listed with its reason", async ({ page }) => {
  await openCockpit(page);
  const text = page.getByTestId("index-chip-text");
  await expect(text).toHaveText(/· 0 skipped ·/);
  const before = await chunkCount(page);

  await store(page, (state) => state.togglePackExclusion("README.md"));
  await expect(text).toHaveText(/^Indexed \d+ files · 1 skipped · [\d,]+ chunks$/, { timeout: 20000 });
  // An excluded file was left out on purpose. That is not a failure.
  await expect(page.getByTestId("index-chip")).not.toHaveAttribute("data-attention", "true");

  await page.getByTestId("index-chip").click();
  const skipped = page.getByTestId("index-chip-panel").getByTestId("index-chip-skipped");
  await expect(skipped).toContainText("1 × excluded from search in this space");
  await expect(skipped).toContainText("README.md");
  await expect(page.getByTestId("index-chip-panel").getByTestId("index-chip-failed")).toHaveCount(0);
  expect(before).toBeGreaterThan(0);
});

test("after a folder load the chip counts skipped files, lists them, and keeps up when files are added", async ({ page }) => {
  test.setTimeout(180_000);
  await installE2eMocks(page);
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await fillCreateContextIdentity(page, `index-chip-${Date.now()}`);

  const root = `hint-chip-${Date.now()}`;
  const folder = join(tmpdir(), root);
  mkdirSync(join(folder, "src"), { recursive: true });
  mkdirSync(join(folder, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(folder, "README.md"), "# Retry service\n\nRetries are capped at three attempts.\n");
  writeFileSync(join(folder, "src", "retry.ts"), "export const MAX_ATTEMPTS = 3;\n");
  // Four files that must not be indexed, each for a different reason.
  writeFileSync(join(folder, "src", "retry.test.ts"), "test('retry', () => {});\n");
  writeFileSync(join(folder, "empty.md"), "");
  writeFileSync(join(folder, "logo.png"), "not really a picture\n");
  writeFileSync(join(folder, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");

  await page.getByTestId("folder-input").setInputFiles(folder);
  await expect(page.getByTestId("review-pack-dialog")).toBeVisible();
  await page.getByTestId("review-pack-index").click();
  await waitForIndexing(page);
  await page.getByTestId("indexing-done").click();
  const cockpit = page.getByTestId("cockpit");
  await expect(cockpit).toHaveAttribute("data-context-status", "ready", { timeout: 30000 });

  const chip = page.getByTestId("index-chip");
  const text = page.getByTestId("index-chip-text");
  const first = await chunkCount(page);
  expect(first).toBeGreaterThan(0);
  await expect(text).toHaveText(`Indexed 2 files · 4 skipped · ${first} chunks`, { timeout: 30000 });
  await expect(chip).toHaveAttribute("data-state", "ready");

  await chip.click();
  const panel = page.getByTestId("index-chip-panel");
  const skipped = panel.getByTestId("index-chip-skipped");
  await expect(panel.getByTestId("index-chip-stored")).toHaveText("2 files stored, 2 files searchable.");
  await expect(skipped).toContainText("1 × tests");
  await expect(skipped).toContainText(`${root}/src/retry.test.ts`);
  await expect(skipped).toContainText("1 × files with no text");
  await expect(skipped).toContainText(`${root}/empty.md`);
  await expect(skipped).toContainText("1 × binaries and media");
  await expect(skipped).toContainText(`${root}/logo.png`);
  await expect(skipped).toContainText("1 × vendor and build folders");
  await expect(skipped).toContainText(`${root}/node_modules/pkg/index.js`);
  // Neither indexed file is listed as skipped.
  await expect(skipped).not.toContainText("README.md");
  await expect(skipped).not.toContainText("src/retry.ts");
  await page.keyboard.press("Escape");

  // Files added mid-session: the chip shows the load, then the new counts.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __chipSeen: string[] }).__chipSeen = seen;
    const node = document.querySelector('[data-testid="index-chip"]');
    if (!node) return;
    const note = () => seen.push(`${node.getAttribute("data-state")}|${node.textContent}`);
    new MutationObserver(note).observe(node, { attributes: true, childList: true, subtree: true, characterData: true });
  });
  await page.locator("input[data-files-input]").setInputFiles([
    { name: "runbook.md", mimeType: "text/markdown", buffer: Buffer.from("# Runbook\n\nReplay failed jobs from the okapi queue.\n") },
    { name: "trace.xyz", mimeType: "application/octet-stream", buffer: Buffer.from("unsupported\n") },
  ]);
  await expect(page.getByTestId("add-material-notice")).toBeVisible({ timeout: 30000 });
  await expect(cockpit).toHaveAttribute("data-context-status", "ready", { timeout: 30000 });
  await expect(text).toHaveText(/^Indexed 3 files · 5 skipped · \d+ chunks$/, { timeout: 30000 });
  const second = await chunkCount(page);
  expect(second).toBeGreaterThan(first);
  await expect(text).toHaveText(`Indexed 3 files · 5 skipped · ${second} chunks`);

  const seen = await page.evaluate(() => (window as unknown as { __chipSeen: string[] }).__chipSeen);
  const working = seen.filter((entry) => entry.startsWith("working|"));
  expect(working.length).toBeGreaterThan(0);
  // While the load ran the chip never claimed a skipped count.
  expect(working.some((entry) => entry.includes("skipped"))).toBe(false);

  await chip.click();
  await expect(skipped).toContainText("1 × unsupported types");
  await expect(skipped).toContainText("trace.xyz");
  // The files the folder load left out are still listed.
  await expect(skipped).toContainText(`${root}/empty.md`);
  await expect(skipped).toContainText(`${root}/src/retry.test.ts`);
  await page.keyboard.press("Escape");

  // The count is stored with the space: a reload does not forget the skipped files.
  await page.reload();
  await expect(cockpit).toHaveAttribute("data-context-status", "ready", { timeout: 30000 });
  await expect(text).toHaveText(`Indexed 3 files · 5 skipped · ${second} chunks`, { timeout: 30000 });

  // Overlay mode hides the file pane. The chip stays.
  await store(page, (state) => state.setOverlay(true));
  await expect(page.locator("main.cockpit-workspace")).toHaveAttribute("data-mode", "overlay");
  await expect(page.getByTestId("index-status")).toHaveCount(0);
  await expect(chip).toBeVisible();
  await expect(text).toHaveText(`Indexed 3 files · 5 skipped · ${second} chunks`);

  // On a phone the chip has its own row and the whole line is readable.
  await store(page, (state) => state.setOverlay(false));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chip).toBeVisible();
  await expectNotClipped(page);
  await chip.click();
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  await expect(skipped).toContainText(`${root}/empty.md`);
});
