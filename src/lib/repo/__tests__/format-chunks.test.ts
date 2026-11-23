import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCsvText, parseDocx, parsePptx } from "../../document/parsers/office-parsers.ts";
import { buildChunks } from "../../search/retrieve.ts";
import { contractsCsv, CSV_HEADER, DECK_SLIDES, roadmapPptx, runbookDocx, servicesXml, XML_SERVICES } from "../../search/__tests__/fixtures/formats.ts";
import { buildFormatChunks, FORMAT_CHUNK_BUDGET, formatKindOf, looksLikeHeaderRow, ROW_GROUP_ROWS } from "../format-chunks.ts";
import type { Chunk, RepoPack } from "../types.ts";

function chunksOf(path: string, content: string): Chunk[] {
  const chunks = buildFormatChunks({ path, content });
  assert.ok(chunks, `${path} should be cut on its structure`);
  return chunks;
}

/**
 * The two rules every format chunk has to keep: its text is the file's text at
 * its offset, and no non-blank line of the file is outside every chunk.
 */
function assertFaithful(content: string, chunks: Chunk[]) {
  const lines = content.split("\n");
  const covered = new Array<boolean>(lines.length).fill(false);
  const ids = new Set<string>();
  for (const chunk of chunks) {
    assert.equal(content.slice(chunk.startOffset, chunk.startOffset + chunk.text.length), chunk.text, `${chunk.id} is not a slice of the file`);
    assert.ok(chunk.text.trim().length > 0, `${chunk.id} is blank`);
    assert.ok(!ids.has(chunk.id), `${chunk.id} is used twice`);
    ids.add(chunk.id);
    assert.equal(content.slice(0, chunk.startOffset).split("\n").length, chunk.startLine, `${chunk.id} start line`);
    assert.equal(content.slice(0, chunk.startOffset + chunk.text.length).split("\n").length, chunk.endLine, `${chunk.id} end line`);
    for (let line = chunk.startLine; line <= chunk.endLine; line += 1) covered[line - 1] = true;
  }
  const missed = lines.flatMap((line, index) => (line.trim() && !covered[index] ? [`${index + 1}: ${line}`] : []));
  assert.deepEqual(missed, [], "lines in no chunk");
}

function pack(files: Array<{ path: string; content: string }>): RepoPack {
  return { id: "p", name: "p", description: "", commits: [], files: files.map((file) => ({ ...file, language: "text" })) };
}

test("only documents, decks, spreadsheets and XML are cut on structure", () => {
  assert.equal(formatKindOf("notes/Runbook.DOCX"), "sections");
  assert.equal(formatKindOf("deck.pptx"), "slides");
  assert.equal(formatKindOf("old.ppt"), "slides");
  assert.equal(formatKindOf("a.csv"), "rows");
  assert.equal(formatKindOf("a.tsv"), "rows");
  assert.equal(formatKindOf("a.xlsx"), "rows");
  assert.equal(formatKindOf("pom.xml"), "xml");
  for (const path of ["src/app.ts", "README.md", "page.html", "data.json", "icon.svg", "notes.txt"]) {
    assert.equal(formatKindOf(path), null, path);
    assert.equal(buildFormatChunks({ path, content: "# Title\n\nbody\n" }), null, path);
  }
});

test("code and markdown are windowed exactly as before", () => {
  const content = Array.from({ length: 60 }, (_, i) => `# Heading ${i}\nexport const value${i} = ${i};`).join("\n");
  for (const path of ["src/values.ts", "docs/guide.md"]) {
    const chunks = buildChunks(pack([{ path, content }]));
    assert.deepEqual(
      chunks.map((chunk) => [chunk.startLine, chunk.endLine]),
      [[1, 28], [23, 50], [45, 72], [67, 94], [89, 116], [111, 120]],
      path,
    );
    assert.ok(chunks.every((chunk) => chunk.heading === undefined), path);
  }
});

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

test("a deck is one chunk per slide, each under its slide number and title", () => {
  const content = parsePptx(roadmapPptx());
  const chunks = chunksOf("roadmap.pptx", content);
  assertFaithful(content, chunks);
  assert.deepEqual(
    chunks.map((chunk) => chunk.heading),
    [
      "Slide 1: Payments Platform: Third Quarter Plan",
      "Slide 2: Ledger Migration",
      "Slide 3: Fraud Scoring",
      "Slide 4: Mobile Checkout",
      "Slide 5",
      "Slide 6: Risks",
      "Slide 7: Hiring Plan",
    ],
  );
  DECK_SLIDES.forEach((slide, index) => {
    const text = chunks[index].text;
    for (const paragraph of slide.body) assert.ok(text.includes(Array.isArray(paragraph) ? paragraph.join("") : paragraph), `slide ${index + 1} body`);
    if (slide.notes) assert.ok(text.includes(`Notes: ${slide.notes}`), `slide ${index + 1} notes`);
    // Nothing from the slides on either side.
    const other = DECK_SLIDES[(index + 1) % DECK_SLIDES.length].body[0];
    assert.ok(!text.includes(Array.isArray(other) ? other.join("") : other), `slide ${index + 1} holds its neighbour`);
  });
});

test("a slide over the budget is split and every part keeps the slide's heading", () => {
  const bullets = Array.from({ length: 40 }, (_, i) => `Milestone ${i + 1} ships the reconciliation worker for region ${i + 1}.`);
  const content = ["--- Slide 1: Intro ---", "Welcome.", "--- Slide 2: Milestones ---", ...bullets, "--- Slide 3 ---", "Thanks."].join("\n");
  const chunks = chunksOf("plan.pptx", content);
  assertFaithful(content, chunks);
  const parts = chunks.filter((chunk) => chunk.heading === "Slide 2: Milestones");
  assert.ok(parts.length >= 2, "the long slide should be split");
  assert.ok(parts.every((chunk) => chunk.text.length <= FORMAT_CHUNK_BUDGET));
  assert.equal(parts.map((chunk) => chunk.text).join("\n").match(/Milestone \d+ ships/g)?.length, 40);
  assert.deepEqual(
    chunks.filter((chunk) => chunk.heading !== "Slide 2: Milestones").map((chunk) => [chunk.heading, chunk.text]),
    [["Slide 1: Intro", "--- Slide 1: Intro ---\nWelcome."], ["Slide 3", "--- Slide 3 ---\nThanks."]],
  );
});

test("a deck stored before titles were kept still gets one chunk per slide", () => {
  const content = "--- Slide 1 ---\nLedger Migration Move the ledger to Cobalt.\nNotes: Freeze schema changes.\n--- Slide 2 ---\nFraud Scoring Replace the rules engine.";
  const chunks = chunksOf("old.pptx", content);
  assertFaithful(content, chunks);
  assert.deepEqual(chunks.map((chunk) => chunk.heading), ["Slide 1", "Slide 2"]);
  assert.ok(chunks[0].text.endsWith("Notes: Freeze schema changes."));
});

test("a legacy deck with headings and no slide markers is cut at its headings", () => {
  const content = "## Ledger Migration\n\n- Move the ledger to Cobalt.\n\n## Fraud Scoring\n\n- Replace the rules engine.";
  const chunks = chunksOf("old.ppt", content);
  assertFaithful(content, chunks);
  assert.deepEqual(chunks.map((chunk) => chunk.heading), ["Ledger Migration", "Fraud Scoring"]);
});

test("a deck with neither markers nor headings is left to line windows", () => {
  assert.equal(buildFormatChunks({ path: "old.ppt", content: "Ledger Migration\nMove the ledger to Cobalt." }), null);
  const chunks = buildChunks(pack([{ path: "old.ppt", content: "Ledger Migration\nMove the ledger to Cobalt." }]));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, undefined);
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

test("a Word document is one chunk per headed section, under its heading path", async () => {
  const content = await parseDocx(runbookDocx());
  const chunks = chunksOf("runbook.docx", content);
  assertFaithful(content, chunks);
  const headings = [...new Set(chunks.map((chunk) => chunk.heading))];
  assert.deepEqual(headings, [
    "Overview",
    "Retry Policy",
    "Escalation > Paging",
    "Escalation > Vendor Contacts",
    "Rollback",
    "Data Retention",
    "Ownership",
  ]);
  const only = (heading: string) => {
    const found = chunks.filter((chunk) => chunk.heading === heading);
    assert.equal(found.length, 1, `${heading} should be one chunk`);
    return found[0].text;
  };
  assert.equal(
    only("Retry Policy"),
    "# Retry Policy\n\nA failed export is attempted three times, with a pause that starts at 30 seconds and doubles each time.\n\nAfter the third failure the batch is moved to the dead-letter queue and nothing further is sent to the bank.",
  );
  // The title and a chapter heading with nothing under them ride with the section that follows.
  assert.ok(only("Overview").startsWith("# Settlement Export Runbook\n\n# Overview\n\n"));
  assert.ok(only("Escalation > Paging").startsWith("# Escalation\n\n## Paging\n\n"));
  // A table stays whole, one row per line.
  assert.ok(only("Escalation > Vendor Contacts").endsWith("Vendor | Contact | Hours\nMeridian Bank | desk@meridian.example | 06:00 to 22:00 UTC\nCorvid Clearing | ops@corvid.example | 24 hours"));
  assert.ok(only("Rollback").includes("- Freeze the outbound SFTP drop with the quarantine flag.\n- Restore the previous batch from the Juniper bucket.\n- Tell the acquiring bank"));
});

test("a section over the budget is split between paragraphs and every part keeps the heading", async () => {
  const content = await parseDocx(runbookDocx());
  const parts = chunksOf("runbook.docx", content).filter((chunk) => chunk.heading === "Data Retention");
  assert.ok(parts.length >= 2, `Data Retention is ${parts.reduce((sum, part) => sum + part.text.length, 0)} characters`);
  for (const part of parts) {
    assert.ok(part.text.length <= FORMAT_CHUNK_BUDGET, `${part.text.length} characters`);
    // Cut between paragraphs: every part ends at the end of a sentence.
    assert.match(part.text, /compliance register\.$/);
  }
  assert.equal(parts.map((part) => part.text).join("\n").match(/Category \d+ covers/g)?.length, 18);
});

test("a split never falls inside a list or a table", () => {
  const sentence = "The exporter writes one batch file per acquiring bank every night and records the totals. ";
  const steps = Array.from({ length: 9 }, (_, i) => `- Step ${i + 1}: confirm the totals for bank ${i + 1} against the statement.`);
  const content = ["# Close", "", sentence.repeat(8).trim(), "", ...steps, "", "Done."].join("\n");
  const parts = chunksOf("close.docx", content);
  assertFaithful(content, parts);
  assert.equal(parts.length, 2);
  // The paragraph alone fits; the paragraph and the list together do not. The list moves whole.
  assert.ok(parts[0].text.endsWith("records the totals."));
  assert.ok(parts[1].text.startsWith("- Step 1:"));
  assert.equal(parts[1].text.match(/^- Step \d+:/gm)?.length, 9);
  assert.ok(parts.every((part) => part.heading === "Close"));
});

test("text above the first heading is a chunk with no heading; a document with no headings is windowed", () => {
  const content = "Draft, not for circulation.\n\n# Scope\n\nThis covers the nightly export.";
  const chunks = chunksOf("memo.docx", content);
  assertFaithful(content, chunks);
  assert.deepEqual(chunks.map((chunk) => [chunk.heading, chunk.text]), [
    [undefined, "Draft, not for circulation."],
    ["Scope", "# Scope\n\nThis covers the nightly export."],
  ]);
  assert.equal(buildFormatChunks({ path: "plain.docx", content: "One paragraph.\n\nAnother paragraph." }), null);
});

test("a heading path drops back when a section closes", () => {
  const content = ["# A", "a text", "## B", "b text", "### C", "c text", "## D", "d text", "# E", "e text"].join("\n");
  assert.deepEqual(chunksOf("x.docx", content).map((chunk) => chunk.heading), ["A", "A > B", "A > B > C", "A > D", "E"]);
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

test("a spreadsheet is cut between rows and every group carries the header row", () => {
  const content = parseCsvText(contractsCsv());
  const chunks = chunksOf("contracts.csv", content);
  assertFaithful(content, chunks);
  const header = CSV_HEADER.join(" | ");
  assert.equal(chunks.length, 6);
  assert.ok(chunks.every((chunk) => chunk.heading === header));
  // The header row itself is in the first group only: nothing is repeated in the text.
  assert.ok(chunks[0].text.startsWith(`${header}\nBrightwave Logistics | `));
  assert.equal(chunks.filter((chunk) => chunk.text.includes(header)).length, 1);
  const rows = chunks.map((chunk) => chunk.text.split("\n").length);
  assert.deepEqual(rows, [ROW_GROUP_ROWS + 1, ROW_GROUP_ROWS, ROW_GROUP_ROWS, ROW_GROUP_ROWS, ROW_GROUP_ROWS, ROW_GROUP_ROWS]);
  // No row is cut: every line has all six cells.
  for (const chunk of chunks) for (const line of chunk.text.split("\n")) assert.equal(line.split(" | ").length, 6, line);
});

test("rows with no header row get groups with no heading", () => {
  const content = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")} | ${1000 + i} | settled`).join("\n");
  const chunks = chunksOf("ledger.csv", content);
  assertFaithful(content, chunks);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.heading === undefined));
});

test("a header row is told from a row of data", () => {
  assert.equal(looksLikeHeaderRow(["Vendor", "Renewal Date", "Annual Cost USD"]), true);
  assert.equal(looksLikeHeaderRow(["Vendor", "", "Q3 Spend"]), true);
  assert.equal(looksLikeHeaderRow(["Brightwave Logistics", "2027-01-01", "12,500"]), false);
  assert.equal(looksLikeHeaderRow(["Acme", "42"]), false);
  assert.equal(looksLikeHeaderRow(["Only one column"]), false);
  assert.equal(looksLikeHeaderRow(["", ""]), false);
});

test("each sheet of a workbook has its own header, under the sheet's name", () => {
  const content = [
    "--- Sheet: Vendors ---",
    "Vendor | Owner",
    ...Array.from({ length: 14 }, (_, i) => `Vendor ${i + 1} Ltd | Owner ${i + 1}`),
    "--- Sheet: Renewals ---",
    "Contract | Renewal Date",
    "MSA-1 | 2027-03-01",
    "--- Sheet: Empty ---",
  ].join("\n");
  const chunks = chunksOf("book.xlsx", content);
  assertFaithful(content, chunks);
  assert.deepEqual(chunks.map((chunk) => chunk.heading), [
    "Sheet: Vendors > Vendor | Owner",
    "Sheet: Vendors > Vendor | Owner",
    "Sheet: Renewals > Contract | Renewal Date",
    "Sheet: Empty",
  ]);
  assert.ok(chunks[0].text.startsWith("--- Sheet: Vendors ---\nVendor | Owner\nVendor 1 Ltd"));
  assert.equal(chunks[1].text, "Vendor 13 Ltd | Owner 13\nVendor 14 Ltd | Owner 14");
  assert.equal(chunks[2].text, "--- Sheet: Renewals ---\nContract | Renewal Date\nMSA-1 | 2027-03-01");
});

test("a tab-separated file is cut the same way, with its header read from the tabs", () => {
  const content = ["Region\tOwner\tQuota", ...Array.from({ length: 20 }, (_, i) => `Region ${i + 1}\tOwner ${i + 1}\t${i * 10}`)].join("\n");
  const chunks = chunksOf("quota.tsv", content);
  assertFaithful(content, chunks);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.heading === "Region | Owner | Quota"));
});

test("a very wide header is cut at a column, not in the middle of a name", () => {
  const columns = Array.from({ length: 80 }, (_, i) => `Column Name ${i + 1}`);
  const content = [columns.join(" | "), columns.map((_, i) => String(i)).join(" | "), columns.map((_, i) => String(i * 2)).join(" | ")].join("\n");
  const heading = chunksOf("wide.csv", content)[0].heading ?? "";
  assert.ok(heading.length <= 240, `${heading.length} characters`);
  assert.match(heading, /^Column Name 1 \| .* \| Column Name \d+$/);
});

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

test("XML is cut between elements and no element is cut in two", () => {
  const content = servicesXml();
  const chunks = chunksOf("services.xml", content);
  assertFaithful(content, chunks);
  assert.ok(chunks.every((chunk) => chunk.text.length <= FORMAT_CHUNK_BUDGET));
  for (const service of XML_SERVICES) {
    const open = `<service name="${service.name}"`;
    const holder = chunks.filter((chunk) => chunk.text.includes(open));
    assert.equal(holder.length, 1, service.name);
    // The whole element, from its opening tag to its own closing tag, is in that one chunk.
    const element = holder[0].text.slice(holder[0].text.indexOf(open));
    assert.match(element, new RegExp(`^<service name="${service.name}"[\\s\\S]*?<queue>${service.queue}</queue>[\\s\\S]*?</service>`), service.name);
    // The comment written above an element stays with it.
    assert.ok(holder[0].text.includes(`<!-- ${service.name} is run by the ${service.owner} team -->`), service.name);
    assert.ok((holder[0].heading ?? "").includes(`service[name=${service.name}]`), `${service.name}: ${holder[0].heading}`);
  }
  assert.equal(chunks[0].heading, "deployment > defaults");
  assert.ok(chunks[0].text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!-- Deployment descriptor'));
  assert.equal(chunks[chunks.length - 1].heading, "deployment > alerts");
  assert.ok(chunks[chunks.length - 1].text.endsWith("</deployment>"));
  assert.match(chunks[1].heading ?? "", /^deployment > services > service\[name=ledger-api\]/);
  // A chunk starts at the start of its first line, so the indent is the file's.
  assert.ok(chunks[1].text.startsWith("  <services>\n    <!-- ledger-api is run by"));
});

test("XML written on one line is still cut between elements, with distinct ids", () => {
  const content = servicesXml().replace(/\n\s*/g, "");
  assert.equal(content.includes("\n"), false);
  const chunks = chunksOf("services.xml", content);
  assert.ok(chunks.length >= 5);
  assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, chunks.length);
  let cursor = 0;
  for (const chunk of chunks) {
    assert.equal(content.slice(chunk.startOffset, chunk.startOffset + chunk.text.length), chunk.text);
    assert.equal(chunk.startOffset, cursor, "one-line XML has nothing between chunks");
    cursor = chunk.startOffset + chunk.text.length;
    assert.ok(chunk.text.length <= FORMAT_CHUNK_BUDGET);
    assert.equal((chunk.text.match(/<service /g) ?? []).length, (chunk.text.match(/<\/service>/g) ?? []).length);
  }
  assert.equal(cursor, content.length);
});

test("a small XML file is one chunk under its root element", () => {
  const content = '<?xml version="1.0"?>\n<settings id="prod">\n  <retries>3</retries>\n</settings>\n';
  const chunks = chunksOf("settings.xml", content);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, "settings[id=prod]");
  assert.equal(chunks[0].text, content.trimEnd());
});

test("a tag-like string inside a comment, CDATA or a quoted attribute is not read as a tag", () => {
  const filler = Array.from({ length: 30 }, (_, i) => `    <entry key="k${i}">value number ${i} for the export worker</entry>`).join("\n");
  const content = `<!DOCTYPE config [ <!ENTITY note "a > b"> ]>
<config>
  <!-- <removed> was here </config> -->
  <rule name="compare" when="a > b &amp;&amp; c < d"/>
  <script><![CDATA[ if (a < b) { return rows[ "</config>"; } ]]></script>
  <entries>
${filler}
  </entries>
</config>
`;
  const chunks = chunksOf("config.xml", content);
  assertFaithful(content, chunks);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].heading, "config > rule[name=compare], script");
  assert.match(chunks[1].heading ?? "", /^config > entries > entry\[key=k0\] to entry\[key=k\d+\]$/);
  assert.ok(chunks[chunks.length - 1].text.endsWith("</config>"));
});

test("XML that is not well formed is left to line windows", () => {
  const filler = Array.from({ length: 40 }, (_, i) => `  <entry>value ${i}</entry>`).join("\n");
  for (const content of [`<config>\n${filler}\n`, `<config>\n${filler}\n</settings>\n`, `<config>\n  <entry>\n</config>\n`, "no tags at all\n"]) {
    assert.equal(buildFormatChunks({ path: "broken.xml", content }), null, content.slice(-24));
    const chunks = buildChunks(pack([{ path: "broken.xml", content }]));
    assert.ok(chunks.length > 0);
    assert.ok(chunks.every((chunk) => chunk.heading === undefined));
    assert.equal(chunks[0].startLine, 1);
  }
});

test("one element holding more text than the budget is split between lines", () => {
  const lines = Array.from({ length: 60 }, (_, i) => `step ${i + 1}: reconcile the batch for bank ${i + 1}`);
  const content = `<runbook>\n<body>\n${lines.join("\n")}\n</body>\n</runbook>\n`;
  const chunks = chunksOf("runbook.xml", content);
  assertFaithful(content, chunks);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.text.length <= FORMAT_CHUNK_BUDGET));
  assert.ok(chunks.every((chunk) => chunk.heading === "runbook > body"));
});

test("buildChunks hands these formats to the structure chunker and keeps scoped ids", () => {
  const content = servicesXml();
  const scope = { workspaceId: "w", contextId: "c", sourceId: "s" };
  const chunks = buildChunks(pack([{ path: "deploy/services.xml", content }]), { chunkScope: scope, sourceId: "s" });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.heading && chunk.sourceId === "s" && chunk.id.startsWith("w:c:s:deploy/services.xml:")));
  assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, chunks.length);
});
