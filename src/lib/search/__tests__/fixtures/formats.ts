/**
 * One fixture per document format the chunker treats by structure: a Word
 * document, a slide deck, a spreadsheet export, an XML config and a PDF.
 *
 * Each is built as the real file format (an OOXML zip, PDF bytes, raw text),
 * so a test goes through the same parser the app uses. The facts in them are
 * invented and each fact lives in exactly one section, slide, row or element,
 * so a recall check has one right answer.
 */
import { strToU8, zipSync } from "fflate";

import { buildPdfBytes, type FixtureItem } from "../../../document/pdf/build-fixture.ts";

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function zip(files: Record<string, string>): ArrayBuffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(files)) entries[name] = strToU8(body);
  return toBuffer(zipSync(entries));
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

export type DocxBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "title"; text: string }
  | { kind: "p"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "table"; rows: string[][] };

function docxParagraph(text: string, style?: string, extra = ""): string {
  const props = style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>` : "";
  return `<w:p>${props}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function docxBlock(block: DocxBlock): string {
  if (block.kind === "heading") return docxParagraph(block.text, `Heading${block.level}`);
  if (block.kind === "title") return docxParagraph(block.text, "Title");
  if (block.kind === "bullet") {
    return docxParagraph(block.text, "ListParagraph", `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`);
  }
  if (block.kind === "table") {
    const rows = block.rows
      .map((row) => `<w:tr>${row.map((cell) => `<w:tc>${docxParagraph(cell)}</w:tc>`).join("")}</w:tr>`)
      .join("");
    return `<w:tbl>${rows}</w:tbl>`;
  }
  return docxParagraph(block.text);
}

/** A .docx with real paragraph styles (Title, Heading 1 to 3), a bulleted list and a table. */
export function buildDocx(blocks: DocxBlock[]): ArrayBuffer {
  const style = (id: string, name: string) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`,
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${style("Title", "Title")}
  ${style("Heading1", "heading 1")}
  ${style("Heading2", "heading 2")}
  ${style("Heading3", "heading 3")}
  ${style("ListParagraph", "List Paragraph")}
</w:styles>`,
    "word/numbering.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${blocks.map(docxBlock).join("")}</w:body>
</w:document>`,
  });
}

/** Filler for the one long section: distinct sentences, none of which a recall question asks about. */
function retentionParagraphs(): DocxBlock[] {
  const systems = [
    "ledger snapshots",
    "settlement exports",
    "reconciliation reports",
    "webhook delivery logs",
    "card authorization traces",
    "refund audit entries",
    "merchant onboarding forms",
    "payout instruction files",
    "currency conversion quotes",
    "dispute evidence bundles",
    "terminal firmware manifests",
    "fee schedule revisions",
    "risk review notes",
    "bank statement imports",
    "tax remittance filings",
    "partner invoice copies",
    "support call recordings",
    "access review attestations",
  ];
  return systems.map((system, index) => ({
    kind: "p" as const,
    text: `Category ${index + 1} covers ${system}. These are held in the regional archive for ${index + 2} years and then purged by the nightly retention job, which records each purge in the compliance register.`,
  }));
}

export const DOCX_BLOCKS: DocxBlock[] = [
  { kind: "title", text: "Settlement Export Runbook" },
  { kind: "heading", level: 1, text: "Overview" },
  {
    kind: "p",
    text: "The settlement exporter writes one batch file per acquiring bank every night. This runbook is for the engineer holding the payments pager.",
  },
  { kind: "heading", level: 1, text: "Retry Policy" },
  { kind: "p", text: "A failed export is attempted three times, with a pause that starts at 30 seconds and doubles each time." },
  { kind: "p", text: "After the third failure the batch is moved to the dead-letter queue and nothing further is sent to the bank." },
  { kind: "heading", level: 1, text: "Escalation" },
  { kind: "heading", level: 2, text: "Paging" },
  { kind: "p", text: "When a batch has been stuck for more than 45 minutes, raise the Opsline rotation named Harbor." },
  { kind: "heading", level: 2, text: "Vendor Contacts" },
  {
    kind: "table",
    rows: [
      ["Vendor", "Contact", "Hours"],
      ["Meridian Bank", "desk@meridian.example", "06:00 to 22:00 UTC"],
      ["Corvid Clearing", "ops@corvid.example", "24 hours"],
    ],
  },
  { kind: "heading", level: 1, text: "Rollback" },
  { kind: "p", text: "To undo a bad export, work through these steps in order:" },
  { kind: "bullet", text: "Freeze the outbound SFTP drop with the quarantine flag." },
  { kind: "bullet", text: "Restore the previous batch from the Juniper bucket." },
  { kind: "bullet", text: "Tell the acquiring bank which file sequence number to ignore." },
  { kind: "heading", level: 1, text: "Data Retention" },
  ...retentionParagraphs(),
  { kind: "heading", level: 1, text: "Ownership" },
  { kind: "p", text: "The exporter is owned by the Tidewater squad, and changes need a review from its tech lead." },
];

export function runbookDocx(): ArrayBuffer {
  return buildDocx(DOCX_BLOCKS);
}

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------

export type SlideSpec = {
  /** Text of the title placeholder. Omit for a slide with no title shape. */
  title?: string;
  /** One paragraph each. A paragraph given as an array is split into that many runs. */
  body: Array<string | string[]>;
  notes?: string;
};

function pptParagraph(paragraph: string | string[]): string {
  const runs = Array.isArray(paragraph) ? paragraph : [paragraph];
  return `<a:p>${runs.map((run) => `<a:r><a:rPr lang="en-US"/><a:t>${esc(run)}</a:t></a:r>`).join("")}</a:p>`;
}

function pptShape(id: number, placeholder: string, paragraphs: Array<string | string[]>): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paragraphs
    .map(pptParagraph)
    .join("")}</p:txBody></p:sp>`;
}

const PPT_NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOC_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * A .pptx whose slides have real title and body placeholders, and speaker notes.
 *
 * `deckOrder` lists slide file numbers in the order the deck shows them, as
 * PowerPoint leaves a file after slides are dragged around: `[3, 1, 2]` means
 * `slide3.xml` is shown first. With it, the deck gets a `presentation.xml`
 * slide list, and each slide's notes live in a part whose number does not
 * match the slide's, reachable only through the slide's relationships.
 */
export function buildPptx(slides: SlideSpec[], options: { deckOrder?: number[] } = {}): ArrayBuffer {
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`,
  };
  slides.forEach((slide, index) => {
    const n = index + 1;
    // The body shape is written first on the second slide, as PowerPoint does
    // when the title was added after the content.
    const title = slide.title === undefined ? "" : pptShape(2, `<p:ph type="${n === 1 ? "ctrTitle" : "title"}"/>`, [slide.title]);
    const body = pptShape(3, `<p:ph idx="1"/>`, slide.body);
    files[`ppt/slides/slide${n}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${PPT_NS}><p:cSld><p:spTree>${n === 2 ? body + title : title + body}</p:spTree></p:cSld></p:sld>`;
    if (slide.notes) {
      const notesNumber = options.deckOrder ? n + 100 : n;
      // A notes page also holds the slide number, as a field in its own placeholder.
      files[`ppt/notesSlides/notesSlide${notesNumber}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes ${PPT_NS}><p:cSld><p:spTree>${pptShape(2, `<p:ph type="body" idx="1"/>`, [slide.notes])}${pptShape(3, `<p:ph type="sldNum" idx="10"/>`, [String(n)])}</p:spTree></p:cSld></p:notes>`;
      if (options.deckOrder) {
        files[`ppt/slides/_rels/slide${n}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${DOC_RELS}/notesSlide" Target="../notesSlides/notesSlide${notesNumber}.xml"/></Relationships>`;
      }
    }
  });
  if (options.deckOrder) {
    files["ppt/presentation.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${PPT_NS} xmlns:r="${DOC_RELS}"><p:sldIdLst>${options.deckOrder
      .map((n, index) => `<p:sldId id="${256 + index}" r:id="rId${n + 10}"/>`)
      .join("")}</p:sldIdLst></p:presentation>`;
    files["ppt/_rels/presentation.xml.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELS_NS}">${slides
      .map((_, index) => `<Relationship Id="rId${index + 11}" Type="${DOC_RELS}/slide" Target="slides/slide${index + 1}.xml"/>`)
      .join("")}</Relationships>`;
  }
  return zip(files);
}

export const DECK_SLIDES: SlideSpec[] = [
  { title: "Payments Platform: Third Quarter Plan", body: ["Prepared for the September steering group"] },
  {
    title: "Ledger Migration",
    body: [
      "Move the double-entry ledger from Postgres 13 to the Cobalt cluster.",
      // Runs split inside a word, as an editor leaves them after a spelling fix.
      ["Cut", "over is planned for the week of 14 October."],
      "Read traffic moves first, writes follow two days later.",
    ],
    notes: "Finance asked for a freeze on schema changes during cutover week.",
  },
  {
    title: "Fraud Scoring",
    body: [
      "Replace the rules engine with the Lantern gradient model.",
      "Target is a false positive rate under 0.8 percent.",
      "Shadow mode runs for 21 days before any decline is automated.",
    ],
  },
  {
    title: "Mobile Checkout",
    body: ["Ship one-tap wallets on the Android client.", "Checkout latency budget is 900 milliseconds at the 95th percentile."],
    notes: "The iOS team is waiting on the tokenization vendor.",
  },
  {
    // No title placeholder: a full-bleed picture slide with a caption box.
    body: ["Architecture sketch of the Halyard event bus and its three consumer groups."],
  },
  {
    title: "Risks",
    body: [
      "The Cobalt cluster has no second region until November.",
      "Lantern needs 40 million labelled transactions and we hold 31 million.",
    ],
  },
  {
    title: "Hiring Plan",
    body: ["Open roles: two staff engineers for ledger, one data scientist for fraud.", "Offers are approved by Priyanka Raman."],
  },
];

export function roadmapPptx(): ArrayBuffer {
  return buildPptx(DECK_SLIDES);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export const CSV_HEADER = ["Vendor", "Service", "Renewal Date", "Annual Cost USD", "Contract Owner", "Notice Period Days"];

const VENDOR_STEMS = [
  "Brightwave", "Kestrel", "Ironbark", "Saltmarsh", "Quillon", "Fernhollow", "Osprey", "Tamarack", "Larkspur", "Greywether",
  "Pinnacle", "Wrenfield", "Stonecrop", "Halcyon", "Marrow", "Thistledown", "Vantage", "Elderwood", "Copperline", "Northgate",
  "Sablewood", "Ravenmoor", "Clearbrook", "Driftwell", "Emberly", "Foxglove", "Gallowglass", "Hartwell", "Inkberry", "Juneau",
  "Kingsley", "Lowland", "Midvale", "Nettlecombe", "Oakhurst", "Pellham", "Quarrystone", "Rosegate", "Silverbirch", "Tollund",
  "Umberfield", "Vellacott", "Whinmoor", "Yarrowby", "Zephyrine", "Ashcombe", "Birchover", "Coldharbour", "Dunmere", "Easterly",
  "Fallowmead", "Glenmarsh", "Heronsgate", "Islebrook", "Jesmond", "Kirkmoor", "Lindenlea", "Mossgiel", "Netherby", "Orchardton",
  "Penhallow", "Quenby", "Ryecroft", "Stanmoor", "Thornaby", "Ulverton", "Varley", "Wetherden", "Yoxall", "Aldermoor",
  "Brackenhurst", "Cranmere",
];
const SERVICES = ["Card processing", "Fraud screening", "Cloud hosting", "Log retention", "Chargeback handling", "Tax filing", "SMS delivery", "Identity checks"];
const OWNERS = ["Dana Whitlock", "Ravi Menon", "Solveig Aas", "Tomas Okafor", "Mei Tanaka", "Ines Carvalho"];
const SUFFIXES = ["Logistics", "Systems", "Analytics", "Payments", "Networks", "Labs"];

/** 72 contract rows. Every vendor name is unique, so each question has one row that answers it. */
export function contractRows(): string[][] {
  return VENDOR_STEMS.map((stem, index) => [
    `${stem} ${SUFFIXES[index % SUFFIXES.length]}`,
    SERVICES[index % SERVICES.length],
    `2027-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
    // A cell with a comma, so the quoting path is exercised on every row.
    `${(12 + index * 3).toLocaleString("en-US")},500`,
    OWNERS[(index * 5 + 2) % OWNERS.length],
    String(30 + (index % 7) * 15),
  ]);
}

export function contractsCsv(): string {
  const quote = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return [CSV_HEADER, ...contractRows()].map((row) => row.map(quote).join(",")).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

export const XML_SERVICES = [
  { name: "ledger-api", port: 8101, timeout: 2500, replicas: 6, owner: "tidewater", queue: "ledger-writes" },
  { name: "fraud-scorer", port: 8102, timeout: 400, replicas: 12, owner: "lantern", queue: "score-requests" },
  { name: "settlement-exporter", port: 8103, timeout: 90000, replicas: 2, owner: "tidewater", queue: "export-batches" },
  { name: "webhook-relay", port: 8104, timeout: 7000, replicas: 4, owner: "harbor", queue: "outbound-hooks" },
  { name: "payout-scheduler", port: 8105, timeout: 15000, replicas: 3, owner: "quayside", queue: "payout-runs" },
  { name: "dispute-intake", port: 8106, timeout: 5200, replicas: 2, owner: "gantry", queue: "dispute-cases" },
  { name: "fx-quoter", port: 8107, timeout: 650, replicas: 8, owner: "meridian", queue: "quote-stream" },
  { name: "merchant-portal", port: 8108, timeout: 3100, replicas: 5, owner: "foreshore", queue: "portal-events" },
  { name: "terminal-gateway", port: 8109, timeout: 1800, replicas: 9, owner: "breakwater", queue: "terminal-frames" },
  { name: "statement-builder", port: 8110, timeout: 45000, replicas: 7, owner: "quayside", queue: "statement-jobs" },
];

/** A deployment descriptor: a prolog, a comment, a defaults block, then one `<service>` element per service. */
export function servicesXml(): string {
  const services = XML_SERVICES.map(
    (service) => `    <!-- ${service.name} is run by the ${service.owner} team -->
    <service name="${service.name}" tier="backend">
      <listen port="${service.port}" protocol="http2"/>
      <limits>
        <timeoutMillis>${service.timeout}</timeoutMillis>
        <replicas min="2" max="${service.replicas}"/>
      </limits>
      <messaging>
        <queue>${service.queue}</queue>
        <deadLetter enabled="true"/>
      </messaging>
      <notes><![CDATA[Reviewed <quarterly> by ${service.owner}]]></notes>
    </service>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Deployment descriptor for the payments platform. -->
<deployment xmlns="urn:example:deploy" environment="production">
  <defaults>
    <region>eu-central</region>
    <logLevel>warn</logLevel>
    <healthCheck path="/healthz" intervalSeconds="20"/>
  </defaults>
  <services>
${services}
  </services>
  <alerts>
    <channel name="pager" target="opsline-harbor"/>
    <channel name="chat" target="#payments-alerts"/>
  </alerts>
</deployment>
`;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function lines(text: string, y: number, size = 12): FixtureItem[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 68) {
      out.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) out.push(current);
  return out.map((str, index) => ({ str, x: 72, y: y - index * 16, size }));
}

/** A section heading: set larger than the body, with space above it. */
function heading(text: string, y: number): FixtureItem[] {
  return [{ str: text, x: 72, y, size: 18 }];
}

export const PDF_SECTIONS = {
  refunds: "Refund Policy",
  chargebacks: "Chargeback Handling",
  windows: "Dispute Windows",
  reserves: "Rolling Reserves",
} as const;

/**
 * A two-page policy PDF with four headed sections and no outline. Several
 * paragraphs sit under each heading, so most of them are more than one
 * paragraph away from the heading that names their section.
 */
export function policyPdf(options: { outline?: boolean } = {}): Uint8Array {
  return buildPdfBytes({
    pages: [
      {
        items: [
          ...heading(PDF_SECTIONS.refunds, 720),
          ...lines("A merchant may return money to a cardholder for up to 180 days after the original capture.", 690),
          ...lines("Partial returns are allowed and each one is recorded against the original capture reference.", 640),
          ...lines("Money goes back to the same card and never to a different account, which is a scheme requirement.", 590),
          ...heading(PDF_SECTIONS.chargebacks, 520),
          ...lines("When an issuer reverses a payment the acquirer debits the merchant and charges a fee of 15 dollars.", 490),
          ...lines("The merchant has ten calendar days to upload compelling evidence through the Gantry portal.", 440),
          ...lines("A case with no upload is closed in favour of the cardholder and the fee is kept by the acquirer.", 390),
        ],
      },
      {
        items: [
          ...heading(PDF_SECTIONS.windows, 720),
          ...lines("Cardholders on consumer credit products can open a case for 120 days counted from the delivery date.", 690),
          ...lines("Commercial cards are limited to 90 days and prepaid cards to 60 days under the same clock.", 640),
          ...heading(PDF_SECTIONS.reserves, 560),
          ...lines("New merchants have ten percent of each payout held back for six months as cover for later reversals.", 530),
          ...lines("The held amount is released in weekly tranches once the six months have passed without an excess rate.", 480),
        ],
      },
    ],
    outline: options.outline
      ? [
          { title: "Part One: Money Back", page: 1 },
          { title: "Part Two: Time Limits and Cover", page: 2 },
        ]
      : undefined,
  });
}

/** A recall question, and the one place in a fixture that answers it. */
export type RecallCase = {
  question: string;
  /** Text that only the answering chunk contains. */
  answer: string;
  /** The heading the answering chunk must carry. */
  heading: string | RegExp;
};

export const DOCX_RECALL: RecallCase[] = [
  { question: "How many times is a failed export retried?", answer: "attempted three times", heading: "Retry Policy" },
  { question: "What happens after the third failure?", answer: "dead-letter queue", heading: "Retry Policy" },
  { question: "Who do we page when a batch is stuck?", answer: "rotation named Harbor", heading: "Escalation > Paging" },
  { question: "What are the hours for Corvid Clearing?", answer: "Corvid Clearing | ops@corvid.example | 24 hours", heading: "Escalation > Vendor Contacts" },
  { question: "How do we roll back a bad export?", answer: "Juniper bucket", heading: "Rollback" },
  { question: "Which squad owns the exporter?", answer: "Tidewater squad", heading: "Ownership" },
  { question: "How long are dispute evidence bundles kept under data retention?", answer: "dispute evidence bundles", heading: "Data Retention" },
];

export const PPTX_RECALL: RecallCase[] = [
  { question: "When is the ledger migration cutover?", answer: "week of 14 October", heading: "Slide 2: Ledger Migration" },
  { question: "What is the false positive target for fraud scoring?", answer: "under 0.8 percent", heading: "Slide 3: Fraud Scoring" },
  { question: "What is the latency budget for mobile checkout?", answer: "900 milliseconds", heading: "Slide 4: Mobile Checkout" },
  { question: "What does the Halyard event bus sketch show?", answer: "three consumer groups", heading: "Slide 5" },
  { question: "What are the risks with the Cobalt cluster?", answer: "no second region until November", heading: "Slide 6: Risks" },
  { question: "Who approves offers in the hiring plan?", answer: "Priyanka Raman", heading: "Slide 7: Hiring Plan" },
  { question: "What did finance ask for during cutover week?", answer: "freeze on schema changes", heading: "Slide 2: Ledger Migration" },
];

export const CSV_RECALL: RecallCase[] = [
  { question: "What is the notice period for Brightwave Logistics?", answer: "Brightwave Logistics", heading: /Notice Period Days/ },
  { question: "Who is the contract owner for Quarrystone Logistics?", answer: "Quarrystone Logistics", heading: /Contract Owner/ },
  { question: "When is the renewal date for Wetherden Systems?", answer: "Wetherden Systems", heading: /Renewal Date/ },
  { question: "What is the annual cost of Cranmere Labs?", answer: "Cranmere Labs", heading: /Annual Cost USD/ },
  { question: "Which service does Heronsgate Networks provide?", answer: "Heronsgate Networks", heading: /Service/ },
];

export const XML_RECALL: RecallCase[] = [
  { question: "What is the timeout for the fraud-scorer service?", answer: "<timeoutMillis>400</timeoutMillis>", heading: /service\[name=fraud-scorer\]/ },
  { question: "Which queue does the payout-scheduler use?", answer: "<queue>payout-runs</queue>", heading: /service\[name=payout-scheduler\]/ },
  { question: "What port does the terminal-gateway listen on?", answer: 'port="8109"', heading: /service\[name=terminal-gateway\]/ },
  { question: "How many replicas can the statement-builder scale to?", answer: 'max="7"', heading: /service\[name=statement-builder\]/ },
  { question: "What is the default health check interval?", answer: 'intervalSeconds="20"', heading: /deployment > defaults/ },
  { question: "Which pager channel do alerts target?", answer: "opsline-harbor", heading: /deployment > alerts/ },
];

export const PDF_RECALL: RecallCase[] = [
  { question: "How long can a merchant issue a refund after capture?", answer: "180 days", heading: PDF_SECTIONS.refunds },
  { question: "Does a refund go back to the same card?", answer: "same card", heading: PDF_SECTIONS.refunds },
  { question: "How many days does a merchant have to upload evidence for a chargeback?", answer: "ten calendar days", heading: PDF_SECTIONS.chargebacks },
  { question: "What is the dispute window for commercial cards?", answer: "limited to 90 days", heading: PDF_SECTIONS.windows },
  { question: "How much of each payout is held as a rolling reserve?", answer: "ten percent", heading: PDF_SECTIONS.reserves },
  { question: "When is the rolling reserve released?", answer: "weekly tranches", heading: PDF_SECTIONS.reserves },
];
