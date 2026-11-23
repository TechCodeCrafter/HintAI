import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { e2eSignIn, USER_A } from "./fixtures/auth";
import { fillCreateContextIdentity, installE2eMocks, typeQuestion, waitForCard, waitForIndexing } from "./fixtures/helpers";
import {
  contractsCsv,
  CSV_HEADER,
  PDF_SECTIONS,
  policyPdf,
  roadmapPptx,
  runbookDocx,
  servicesXml,
} from "../src/lib/search/__tests__/fixtures/formats";

type ChunkView = { path: string; kind: string; heading?: string; text: string; page?: number };

/** The chunks search runs over, as the page holds them. */
function chunks(page: Page): Promise<ChunkView[]> {
  return page.evaluate(() =>
    ((window.useMeetHint?.getState() as { chunks?: ChunkView[] } | undefined)?.chunks ?? []).map((chunk) => ({
      path: chunk.path,
      kind: chunk.kind,
      heading: chunk.heading,
      text: chunk.text,
      page: chunk.page,
    })),
  );
}

const of = (all: ChunkView[], file: string) => all.filter((chunk) => chunk.path.endsWith(file));

/**
 * The browser reads these files with its own builds of the parsers (mammoth's
 * browser bundle, the DOM path for spreadsheets, pdf.js in a worker), which a
 * unit test under Node does not run. This loads one real file of each format
 * and checks what the page ends up searching.
 */
test("a Word document, a deck, a spreadsheet, an XML file and a PDF are chunked on their structure in the browser", async ({ page }) => {
  test.setTimeout(240_000);
  await installE2eMocks(page);
  await e2eSignIn(page, USER_A);
  await page.goto("/create");
  await fillCreateContextIdentity(page, `formats-${Date.now()}`);

  const folder = join(tmpdir(), `hint-formats-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "runbook.docx"), Buffer.from(runbookDocx()));
  writeFileSync(join(folder, "roadmap.pptx"), Buffer.from(roadmapPptx()));
  writeFileSync(join(folder, "contracts.csv"), contractsCsv());
  writeFileSync(join(folder, "services.xml"), servicesXml());
  writeFileSync(join(folder, "policy.pdf"), Buffer.from(policyPdf()));

  await page.getByTestId("folder-input").setInputFiles(folder);
  await expect(page.getByTestId("review-pack-dialog")).toBeVisible();
  await page.getByTestId("review-pack-index").click();
  await waitForIndexing(page);
  await page.getByTestId("indexing-done").click();
  const cockpit = page.getByTestId("cockpit");
  await expect(cockpit).toHaveAttribute("data-context-status", "ready", { timeout: 30000 });

  const first = await chunks(page);

  // Word: one chunk per headed section, under its heading path.
  expect([...new Set(of(first, "runbook.docx").map((chunk) => chunk.heading))]).toEqual([
    "Overview",
    "Retry Policy",
    "Escalation > Paging",
    "Escalation > Vendor Contacts",
    "Rollback",
    "Data Retention",
    "Ownership",
  ]);
  const retry = of(first, "runbook.docx").filter((chunk) => chunk.heading === "Retry Policy");
  expect(retry).toHaveLength(1);
  expect(retry[0].text).toBe(
    "# Retry Policy\n\nA failed export is attempted three times, with a pause that starts at 30 seconds and doubles each time.\n\nAfter the third failure the batch is moved to the dead-letter queue and nothing further is sent to the bank.",
  );
  expect(of(first, "runbook.docx").find((chunk) => chunk.heading === "Escalation > Vendor Contacts")?.text).toContain(
    "Corvid Clearing | ops@corvid.example | 24 hours",
  );

  // Deck: one chunk per slide.
  expect(of(first, "roadmap.pptx").map((chunk) => chunk.heading)).toEqual([
    "Slide 1: Payments Platform: Third Quarter Plan",
    "Slide 2: Ledger Migration",
    "Slide 3: Fraud Scoring",
    "Slide 4: Mobile Checkout",
    "Slide 5",
    "Slide 6: Risks",
    "Slide 7: Hiring Plan",
  ]);
  expect(of(first, "roadmap.pptx")[1].text).toBe(
    [
      "--- Slide 2: Ledger Migration ---",
      "Move the double-entry ledger from Postgres 13 to the Cobalt cluster.",
      "Cutover is planned for the week of 14 October.",
      "Read traffic moves first, writes follow two days later.",
      "Notes: Finance asked for a freeze on schema changes during cutover week.",
    ].join("\n"),
  );

  // Spreadsheet: row groups, each under the header row.
  const rows = of(first, "contracts.csv");
  expect(rows).toHaveLength(6);
  expect(rows.every((chunk) => chunk.heading === CSV_HEADER.join(" | "))).toBe(true);
  expect(rows.filter((chunk) => chunk.text.includes(CSV_HEADER.join(" | ")))).toHaveLength(1);

  // XML: whole elements, under their path.
  const xml = of(first, "services.xml");
  expect(xml[0].heading).toBe("deployment > defaults");
  expect(xml[xml.length - 1].heading).toBe("deployment > alerts");
  const scorer = xml.filter((chunk) => chunk.text.includes('<service name="fraud-scorer"'));
  expect(scorer).toHaveLength(1);
  expect(scorer[0].heading).toContain("service[name=fraud-scorer]");
  expect(scorer[0].text).toMatch(/<service name="fraud-scorer"[\s\S]*<queue>score-requests<\/queue>[\s\S]*?<\/service>/);

  // PDF: every paragraph under its page and its section.
  const pdf = of(first, "policy.pdf");
  expect(pdf).toHaveLength(10);
  expect(pdf.every((chunk) => chunk.kind === "document")).toBe(true);
  expect(pdf.map((chunk) => [chunk.page, chunk.heading])).toEqual([
    [1, PDF_SECTIONS.refunds], [1, PDF_SECTIONS.refunds], [1, PDF_SECTIONS.refunds],
    [1, PDF_SECTIONS.chargebacks], [1, PDF_SECTIONS.chargebacks], [1, PDF_SECTIONS.chargebacks],
    [2, PDF_SECTIONS.windows], [2, PDF_SECTIONS.windows],
    [2, PDF_SECTIONS.reserves], [2, PDF_SECTIONS.reserves],
  ]);

  // A question whose answer is written as a sentence is spoken from the
  // section, the slide or the page that holds it, and cited there.
  const spoken: Array<[string, string, RegExp]> = [
    ["How many times is a failed export retried?", "runbook.docx", /attempted three times/],
    ["When is the ledger migration cutover?", "roadmap.pptx", /week of 14 October/],
    ["When is the held amount released?", "policy.pdf", /released in weekly tranches/],
  ];
  // A table row and an XML element are not sentences, so nothing is spoken.
  // The chunk that holds the answer is still the first thing search returns.
  const found: Array<[string, string, string]> = [
    ["What is the notice period for Brightwave Logistics?", "contracts.csv", "Notice Period Days"],
    ["What is the timeout for the fraud-scorer service?", "services.xml", '<service name="fraud-scorer"'],
  ];
  await page.getByTestId("search-details-toggle").click();
  for (const [question, file, answer] of spoken) {
    await typeQuestion(page, question);
    const card = await waitForCard(page);
    await expect(page.getByTestId("search-details-query")).toContainText(question, { timeout: 20000 });
    await expect(card.getByTestId("card-say"), question).toContainText(answer, { timeout: 20000 });
    await expect(card.getByTestId("card-citation").first(), question).toContainText(file);
  }
  for (const [question, file, text] of found) {
    await typeQuestion(page, question);
    const card = await waitForCard(page);
    await expect(page.getByTestId("search-details-query")).toContainText(question, { timeout: 20000 });
    const top = page.getByTestId("search-details-hit").first();
    await expect(top, question).toContainText(file);
    await expect(top, question).toContainText(text);
    await expect(card.getByTestId("card-say"), question).toHaveCount(0);
    await expect(card.getByTestId("card-reason"), question).toContainText("nothing in it states this in words I can cite");
  }
});
