/**
 * Recall checks for the formats that are cut on their own structure.
 *
 * One fixture per format (a Word document, a deck, a spreadsheet, an XML file,
 * a PDF), each built as the real file and loaded through the same path the app
 * uses: parse, store, chunk, index. All five sit in one space, so a question
 * has to find its answer among the other four files as well as inside its own.
 *
 * A case passes when the chunk that holds the answer is the first result, and
 * that chunk carries the heading it sits under.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { chunkEquivalent, indexContext } from "../../context/chunk-index.ts";
import { createMemoryRepository } from "../../context/memory.ts";
import { persistPackAsContext } from "../../context/service.ts";
import { isPdfSource } from "../../context/types.ts";
import { buildPdfBytes, type FixtureItem } from "../../document/pdf/build-fixture.ts";
import { parseAndPersistPdf } from "../../document/pdf/ingest.ts";
import { packFromFiles } from "../../repo/folder.ts";
import type { Chunk, DocumentChunk, IndexedChunk } from "../../repo/types.ts";
import { isDocumentChunk } from "../../repo/types.ts";
import { embedIndexedChunks, hashChunk } from "../embed-chunks.ts";
import { bagEmbedding384, embeddingTextFor, setEmbedderForTests } from "../embedding.ts";
import { retrieveStructural } from "../hybrid.ts";
import { hybridRetrieve, knownTerms, nameCredit, retrieve } from "../retrieve.ts";
import { RETRIEVAL_WEIGHTS } from "../retrieval-weights.ts";
import { createMemoryVectorStore } from "../vector-store.ts";
import {
  contractsCsv,
  CSV_HEADER,
  CSV_RECALL,
  DOCX_RECALL,
  PDF_RECALL,
  PDF_SECTIONS,
  policyPdf,
  PPTX_RECALL,
  roadmapPptx,
  runbookDocx,
  servicesXml,
  XML_RECALL,
  type RecallCase,
} from "./fixtures/formats.ts";

afterEach(() => {
  setEmbedderForTests(null);
});

async function pdfChunks(bytes: Uint8Array, path = "policy.pdf"): Promise<DocumentChunk[]> {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "pdf" });
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const [source] = await repo.upsertSources(context.id, [{ path, kind: "pdf", blob: new Blob([copy], { type: "application/pdf" }) }]);
  assert.ok(isPdfSource(source));
  await parseAndPersistPdf(repo, context.id, source);
  return (await indexContext(repo, context.id)).chunks.filter(isDocumentChunk);
}

let loaded: Promise<IndexedChunk[]> | null = null;

/** The five fixtures, loaded into one space the way a folder and a PDF upload are. */
function corpus(): Promise<IndexedChunk[]> {
  loaded ??= (async () => {
    const folder = await packFromFiles([
      new File([runbookDocx()], "runbook.docx"),
      new File([roadmapPptx()], "roadmap.pptx"),
      new File([contractsCsv()], "contracts.csv", { type: "text/csv" }),
      new File([servicesXml()], "services.xml", { type: "text/xml" }),
    ]);
    assert.deepEqual(folder.failed, []);
    const repo = createMemoryRepository();
    const { context } = await persistPackAsContext(folder.pack, repo);
    const bytes = policyPdf();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const sources = await repo.upsertSources(context.id, [
      { path: "policy.pdf", kind: "pdf", blob: new Blob([copy], { type: "application/pdf" }) },
    ]);
    const pdf = sources.find(isPdfSource);
    assert.ok(pdf);
    await parseAndPersistPdf(repo, context.id, pdf);
    return (await indexContext(repo, context.id)).chunks;
  })();
  return loaded;
}

function headingOf(chunk: IndexedChunk): string | undefined {
  return "heading" in chunk ? chunk.heading : undefined;
}

function assertRecall(cases: RecallCase[], file: string, search: (question: string) => IndexedChunk[] | Promise<IndexedChunk[]>) {
  return Promise.all(
    cases.map(async (item) => {
      const hits = await search(item.question);
      const top = hits[0];
      assert.ok(top, `no result for: ${item.question}`);
      assert.ok(top.path.endsWith(file), `${item.question}: first result is ${top.path}`);
      assert.ok(
        top.text.includes(item.answer),
        `${item.question}: the first result does not hold "${item.answer}". It is under ${JSON.stringify(headingOf(top))}.`,
      );
      const heading = headingOf(top) ?? "";
      if (typeof item.heading === "string") assert.equal(heading, item.heading, item.question);
      else assert.match(heading, item.heading, item.question);
    }),
  );
}

const FORMATS: Array<[string, string, RecallCase[]]> = [
  ["Word document", "runbook.docx", DOCX_RECALL],
  ["slide deck", "roadmap.pptx", PPTX_RECALL],
  ["spreadsheet", "contracts.csv", CSV_RECALL],
  ["XML file", "services.xml", XML_RECALL],
  ["PDF", "policy.pdf", PDF_RECALL],
];

for (const [label, file, cases] of FORMATS) {
  test(`recall, ${label}: the chunk that answers is the first result and carries its heading`, async () => {
    const chunks = await corpus();
    await assertRecall(cases, file, (question) => retrieve(question, chunks, 6));
  });
}

test("recall holds on the hybrid path, with all three channels scoring", async () => {
  // A bag-of-words embedder: enough to give the semantic channel real scores
  // in a unit test. It is not the embedding model the app runs.
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const chunks = await corpus();
  const store = createMemoryVectorStore();
  const embedded = await embedIndexedChunks(chunks, store);
  assert.equal(embedded.wrote, chunks.length);
  const seen = new Set<string>();
  for (const [, file, cases] of FORMATS) {
    await assertRecall(cases, file, async (question) => {
      const hits = await hybridRetrieve(question, chunks, store, 6);
      for (const signal of hits[0]?.signals ?? []) seen.add(signal);
      return hits;
    });
  }
  assert.deepEqual([...seen].filter((signal) => ["lexical", "semantic", "structural"].includes(signal)).sort(), ["lexical", "semantic", "structural"]);
});

test("every chunk of the five fixtures is found under a heading, and the text is still the file's own", async () => {
  const chunks = await corpus();
  const byFile = new Map<string, IndexedChunk[]>();
  for (const chunk of chunks) byFile.set(chunk.path.split("/").pop() ?? chunk.path, [...(byFile.get(chunk.path.split("/").pop() ?? chunk.path) ?? []), chunk]);
  assert.deepEqual(
    [...byFile].map(([file, list]) => [file, list.length]).sort(),
    [["contracts.csv", 6], ["policy.pdf", 10], ["roadmap.pptx", 7], ["runbook.docx", 9], ["services.xml", 7]],
  );
  assert.ok(chunks.every((chunk) => Boolean(headingOf(chunk))), "a chunk has no heading");
  // The heading is context, not content: a spreadsheet's header row is in its first chunk only.
  const header = CSV_HEADER.join(" | ");
  assert.equal(byFile.get("contracts.csv")?.filter((chunk) => chunk.text.includes(header)).length, 1);
});

// ---------------------------------------------------------------------------
// What the heading is worth
// ---------------------------------------------------------------------------

function row(id: string, text: string, heading?: string, path = "contracts.csv"): Chunk {
  return { id, kind: "code", path, startLine: 1, endLine: 1, startOffset: 0, text, ...(heading ? { heading } : {}) };
}

test("a word in the heading counts for a chunk whose text does not have it", () => {
  const header = "Vendor | Renewal Date | Notice Period Days";
  const chunks = [
    row("a", "Brightwave Logistics | 2027-01-01 | 30", header),
    row("b", "Kestrel Systems | 2027-02-02 | 45", header),
    row("c", "Brightwave Logistics signed the master agreement in March.", undefined, "notes.txt"),
  ];
  const hits = retrieve("What is the notice period for Brightwave Logistics?", chunks, 6);
  assert.equal(hits[0].id, "a");
  assert.ok((hits[0].boosts?.heading ?? 0) > 0, JSON.stringify(hits[0].boosts));
  // The other row group of the same table is known to be about notice periods too.
  const other = hits.find((hit) => hit.id === "b");
  assert.ok(other && (other.boosts?.heading ?? 0) > 0 && !other.boosts?.body);
  // A chunk with no heading scores exactly as it did: text only.
  const plain = hits.find((hit) => hit.id === "c");
  assert.ok(plain && plain.boosts?.heading === undefined);
});

test("a word in both the heading and the text is scored once, as text", () => {
  const first = row("first", "# Retry Policy\n\nA failed export is attempted three times.", "Retry Policy", "runbook.docx");
  const bare = row("bare", "# Retry Policy\n\nA failed export is attempted three times.", undefined, "runbook.docx");
  const [withHeading] = retrieve("retry policy", [first], 6);
  const [without] = retrieve("retry policy", [bare], 6);
  assert.equal(withHeading.boosts?.heading, undefined);
  assert.equal(withHeading.score, without.score);
});

test("a word in the text outranks the same word in a heading only", () => {
  const said = row("said", "Refunds are returned to the original card within five days.", "Chargebacks", "policy.docx");
  const under = row("under", "Money is returned to the original card within five days.", "Refunds", "policy.docx");
  const hits = retrieve("refunds", [under, said], 6);
  assert.deepEqual(hits.map((hit) => hit.id), ["said", "under"]);
  assert.ok((hits[0].boosts?.body ?? 0) > (hits[1].boosts?.heading ?? 0));
  assert.ok(RETRIEVAL_WEIGHTS.headingTerm < 1.6);
});

test("a word that only headings hold is known to the material and backs a chunk", () => {
  const under = row("under", "Money is returned to the original card within five days.", "Refunds", "docs/policy.docx");
  const other = row("other", "Reserves are released in weekly tranches.", "Reserves", "docs/policy.docx");
  // Known: so it is weighed by how many chunks sit under it, not as a word nobody uses.
  assert.deepEqual([...knownTerms(["refunds", "zebra"], [under, other])], ["refunds"]);
  // A file name counts in full when the heading backs the rest of the question.
  assert.equal(nameCredit(["policy", "refunds"], under), 1);
  assert.equal(nameCredit(["policy", "refunds"], other), RETRIEVAL_WEIGHTS.nameOnlyCredit);
  // And the bonus for a docs path is given in full, as it is when the text backs the question.
  const [hit] = retrieve("refunds", [under, other], 6);
  assert.equal(hit.id, "under");
  assert.equal(hit.boosts?.authoritativePath, RETRIEVAL_WEIGHTS.authoritativePath);
});

test("the structural channel scores a heading by the share of the question it holds", () => {
  const wide = Array.from({ length: 40 }, (_, i) => `Column ${i + 1}`).join(" | ");
  const chunks = [
    row("slide", "Cutover is planned for the week of 14 October.", "Slide 2: Ledger Migration", "roadmap.pptx"),
    row("other", "Ship one-tap wallets on the Android client.", "Slide 4: Mobile Checkout", "roadmap.pptx"),
    row("wide", "1 | 2 | 3", `Ledger | Migration | Cutover | ${wide}`, "wide.csv"),
    row("plain", "The ledger migration cutover is in October.", undefined, "notes.txt"),
  ];
  const hits = retrieveStructural("ledger migration cutover", chunks, 10);
  const score = (id: string) => hits.find((hit) => hit.id === id)?.structuralBoosts?.headingMatch;
  // Two of the three words are in the slide's title.
  assert.equal(score("slide"), (RETRIEVAL_WEIGHTS.headingMatch * 2) / 3);
  // All three: the most a heading can add, however many columns it has.
  assert.equal(score("wide"), RETRIEVAL_WEIGHTS.headingMatch);
  assert.equal(score("other"), undefined);
  assert.equal(score("plain"), undefined);
});

test("the heading is embedded with a chunk unless the chunk's first line already holds it", () => {
  assert.equal(embeddingTextFor("row 40 | 2027", "a.csv", "Vendor | Renewal Date"), "a.csv\nVendor | Renewal Date\nrow 40 | 2027");
  assert.equal(embeddingTextFor("# Retry Policy\n\nThree times.", "a.docx", "Retry Policy"), "a.docx\n# Retry Policy\n\nThree times.");
  assert.equal(embeddingTextFor("## Paging\n\nRaise Harbor.", "a.docx", "Escalation > Paging"), "a.docx\nEscalation > Paging\n## Paging\n\nRaise Harbor.");
  // No heading: byte for byte what was embedded before, so stored vectors stay valid.
  assert.equal(embeddingTextFor("export const a = 1;", "src/a.ts"), "src/a.ts\nexport const a = 1;");
  assert.equal(embeddingTextFor("export const a = 1;", "src/a.ts", undefined), "src/a.ts\nexport const a = 1;");
  assert.equal(hashChunk({ text: "x", path: "a.ts" }), hashChunk({ text: "x", path: "a.ts", heading: undefined }));
  assert.notEqual(hashChunk({ text: "x", path: "a.csv" }), hashChunk({ text: "x", path: "a.csv", heading: "Vendor" }));
});

test("a stored chunk whose heading changed is not treated as current", () => {
  const before = row("a", "Kestrel Systems | 45", "Vendor | Notice");
  assert.equal(chunkEquivalent(before, { ...before }), true);
  assert.equal(chunkEquivalent(before, { ...before, heading: "Vendor | Notice Period Days" }), false);
  assert.equal(chunkEquivalent(before, row("a", "Kestrel Systems | 45")), false);
});

// ---------------------------------------------------------------------------
// PDF: page and section
// ---------------------------------------------------------------------------

function para(text: string, y: number): FixtureItem[] {
  return [{ str: text, x: 72, y, size: 12 }];
}

test("every PDF paragraph carries the section it is in, not only the first under a heading", async () => {
  const chunks = await pdfChunks(policyPdf());
  assert.deepEqual(
    chunks.map((chunk) => [chunk.page, chunk.heading]),
    [
      [1, PDF_SECTIONS.refunds], [1, PDF_SECTIONS.refunds], [1, PDF_SECTIONS.refunds],
      [1, PDF_SECTIONS.chargebacks], [1, PDF_SECTIONS.chargebacks], [1, PDF_SECTIONS.chargebacks],
      [2, PDF_SECTIONS.windows], [2, PDF_SECTIONS.windows],
      [2, PDF_SECTIONS.reserves], [2, PDF_SECTIONS.reserves],
    ],
  );
  // A heading is a label on the chunk. It is not chunk text, and no chunk spans a page.
  for (const title of Object.values(PDF_SECTIONS)) assert.ok(chunks.every((chunk) => !chunk.text.includes(title)), title);
});

test("the heading on the page is used before the outline, which only knows the page", async () => {
  const chunks = await pdfChunks(policyPdf({ outline: true }));
  assert.deepEqual([...new Set(chunks.map((chunk) => chunk.heading))], Object.values(PDF_SECTIONS));
});

test("a page with no heading of its own is in the outline section that began before it", async () => {
  const body = (page: number) => [
    ...para(`Settlement files for cycle ${page} are written to the regional archive every night.`, 700),
    ...para(`Operators confirm the totals for cycle ${page} against the bank statement by noon.`, 660),
  ];
  const chunks = await pdfChunks(
    buildPdfBytes({
      pages: [{ items: body(1) }, { items: body(2) }, { items: body(3) }, { items: body(4) }],
      outline: [
        { title: "Nightly Settlement", page: 2 },
        { title: "Month End", page: 4 },
      ],
    }),
  );
  const byPage = new Map<number, Set<string | undefined>>();
  for (const chunk of chunks) byPage.set(chunk.page, new Set([...(byPage.get(chunk.page) ?? []), chunk.heading]));
  assert.deepEqual(
    [...byPage].map(([page, headings]) => [page, [...headings]]),
    [
      // Before the first outline entry: no section is known.
      [1, [undefined]],
      [2, ["Nightly Settlement"]],
      // No entry points here; the section from page 2 continues.
      [3, ["Nightly Settlement"]],
      [4, ["Month End"]],
    ],
  );
});

test("a heading found by layout is not carried over a page break", async () => {
  const chunks = await pdfChunks(
    buildPdfBytes({
      pages: [
        {
          items: [
            { str: "Refund Policy", x: 72, y: 720, size: 18 },
            ...para("A merchant may return money to a cardholder for up to 180 days.", 690),
          ],
        },
        { items: para("Reserves are released in weekly tranches after six months have passed.", 700) },
      ],
    }),
  );
  assert.deepEqual(chunks.map((chunk) => [chunk.page, chunk.heading]), [[1, "Refund Policy"], [2, undefined]]);
});

test("a first line that is not set larger than the text under it is not taken for a heading", async () => {
  const chunks = await pdfChunks(
    buildPdfBytes({
      pages: [{ items: [...para("Refund policy for merchants", 720), ...para("A merchant may return money to a cardholder for up to 180 days.", 704)] }],
    }),
  );
  assert.ok(chunks.length > 0);
  assert.ok(chunks.every((chunk) => chunk.heading === undefined));
  assert.ok(chunks.some((chunk) => chunk.text.includes("Refund policy for merchants")));
});
