import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { persistPackAsContext } from "../../../context/service.ts";
import { createMemoryRepository } from "../../../context/memory.ts";
import { indexContext } from "../../../context/chunk-index.ts";
import { packFromFiles, prunePack } from "../../../repo/folder.ts";
import { officeReadError, parseDocx, parsePpt, parsePptx, parseXlsx } from "../office-parsers.ts";

function crc32(data: Uint8Array): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function u16(n: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, n, true);
  return out;
}

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Minimal ZIP so tests can build a real DOCX without adding jszip. */
function zipFiles(files: Record<string, string>): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const names = Object.keys(files);
  for (const name of names) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(files[name] ?? "");
    const crc = crc32(data);
    const compressed = deflateRawSync(data);
    const store = compressed.length >= data.length;
    const payload = store ? data : new Uint8Array(compressed);
    const method = store ? 0 : 8;
    const local = concat(
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(payload.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      payload,
    );
    locals.push(local);
    centrals.push(
      concat(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(method),
        u16(0),
        u16(0),
        u32(crc),
        u32(payload.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ),
    );
    offset += local.length;
  }
  const central = concat(...centrals);
  const zip = concat(
    ...locals,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(names.length),
    u16(names.length),
    u32(central.length),
    u32(offset),
    u16(0),
  );
  return bytesToBuffer(zip);
}

function bytesToBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** Build a legacy OLE2 (.ppt) compound file: header + FAT + directory + one `PowerPoint Document` stream. */
function minimalLegacyPpt(slideText: string): ArrayBuffer {
  const SECT = 512;
  const atom = (rectype: number, payload: Uint8Array): Uint8Array =>
    concat(u16(0), u16(rectype), u32(payload.length), payload);
  const utf16 = (text: string): Uint8Array => {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      out[i * 2] = code & 0xff;
      out[i * 2 + 1] = code >> 8;
    }
    return out;
  };
  const streamAtoms = concat(
    atom(3999, new Uint8Array([1])),
    atom(4000, utf16(slideText)),
    atom(3999, new Uint8Array([1])),
  );
  // Pad so the stream crosses the 4 KiB mini-stream cutoff and stays record-aligned (zeros parse as no-op len-0 atoms).
  const targetLen = Math.max(4104, Math.ceil(streamAtoms.length / 8) * 8);
  const stream = new Uint8Array(targetLen);
  stream.set(streamAtoms, 0);
  const dataSectors = Math.ceil(stream.length / SECT);
  const fat = new Uint8Array(SECT).fill(0xff);
  const fatDv = new DataView(fat.buffer);
  fatDv.setUint32(0, 0xfffffffd, true);
  fatDv.setUint32(4, 0xfffffffe, true);
  for (let i = 2; i < 2 + dataSectors - 1; i += 1) fatDv.setUint32(i * 4, i + 1, true);
  fatDv.setUint32((2 + dataSectors - 1) * 4, 0xfffffffe, true);
  const direntry = (
    name: string,
    type: number,
    left: number,
    right: number,
    child: number,
    start: number,
    size: number,
  ): Uint8Array => {
    const out = new Uint8Array(128);
    const nameBytes = new Uint8Array((name.length + 1) * 2);
    for (let i = 0; i < name.length; i += 1) {
      const code = name.charCodeAt(i);
      nameBytes[i * 2] = code & 0xff;
      nameBytes[i * 2 + 1] = code >> 8;
    }
    out.set(nameBytes, 0);
    const dv = new DataView(out.buffer);
    dv.setUint16(64, nameBytes.length, true);
    out[66] = type;
    out[67] = 1;
    dv.setUint32(68, left, true);
    dv.setUint32(72, right, true);
    dv.setUint32(76, child, true);
    dv.setUint32(116, start, true);
    dv.setUint32(120, size, true);
    return out;
  };
  const ENDOFCHAIN = 0xfffffffe;
  const ENDOFSID = 0xffffffff;
  const directory = concat(
    direntry("Root Entry", 5, ENDOFSID, ENDOFSID, 1, ENDOFCHAIN, 0),
    direntry("PowerPoint Document", 2, ENDOFSID, ENDOFSID, ENDOFSID, 2, stream.length),
    new Uint8Array(SECT - 2 * 128).fill(0xff),
  );
  const header = new Uint8Array(SECT);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  const hdv = new DataView(header.buffer);
  hdv.setUint16(24, 0x003e, true);
  hdv.setUint16(26, 3, true);
  hdv.setUint16(28, 0xfffe, true);
  hdv.setUint16(30, 9, true);
  hdv.setUint16(32, 6, true);
  hdv.setUint32(40, 0, true);
  hdv.setUint32(44, 1, true);
  hdv.setUint32(48, 1, true);
  hdv.setUint32(56, 4096, true);
  hdv.setUint32(60, ENDOFCHAIN, true);
  hdv.setUint32(64, 0, true);
  hdv.setUint32(68, ENDOFCHAIN, true);
  hdv.setUint32(72, 0, true);
  hdv.setUint32(76, 0, true);
  for (let i = 1; i < 109; i += 1) hdv.setUint32(76 + i * 4, 0xffffffff, true);
  const padded = new Uint8Array(dataSectors * SECT);
  padded.set(stream, 0);
  return bytesToBuffer(concat(header, fat, directory, padded));
}

function minimalPptx(slideText: string, noteText?: string): ArrayBuffer {
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
    "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${slideText}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`,
  };
  if (noteText) {
    files["ppt/notesSlides/notesSlide1.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${noteText}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`;
  }
  return zipFiles(files);
}

function minimalDocx(text: string): ArrayBuffer {
  return zipFiles({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`,
  });
}

function xlsxBuffer(): ArrayBuffer {
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>Name</t></is></c>
      <c r="B1" t="inlineStr"><is><t>Role</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>Alice</t></is></c>
      <c r="B2" t="inlineStr"><is><t>Engineer</t></is></c>
    </row>
  </sheetData>
</worksheet>`;
  return zipFiles({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    "xl/worksheets/sheet1.xml": sheet,
  });
}

test("parseDocx extracts text", async () => {
  const result = await parseDocx(minimalDocx("Office hours Thursday"));
  assert.equal(typeof result, "string");
  assert.match(result, /Office hours Thursday/);
});

test("parseDocx rejects an empty buffer", async () => {
  await assert.rejects(() => parseDocx(new ArrayBuffer(0)));
});

test("parseXlsx extracts sheet text", async () => {
  const result = await parseXlsx(xlsxBuffer());
  assert.match(result, /Name \| Role/);
  assert.match(result, /Alice \| Engineer/);
});

test("parsePptx extracts slide text", () => {
  const result = parsePptx(minimalPptx("Quarterly roadmap review"));
  assert.match(result, /--- Slide 1 ---/);
  assert.match(result, /Quarterly roadmap review/);
});

test("parsePptx extracts speaker notes when present", () => {
  const result = parsePptx(minimalPptx("Quarterly roadmap review", "Mention the launch date"));
  assert.match(result, /Notes: Mention the launch date/);
});

test("parsePptx rejects an empty buffer", () => {
  assert.throws(() => parsePptx(new ArrayBuffer(0)));
});

test("parsePpt rejects non-OLE buffers", async () => {
  await assert.rejects(() => parsePpt(new TextEncoder().encode("hello").buffer));
});

test("parsePpt extracts slide text from a legacy OLE .ppt", async () => {
  const result = await parsePpt(minimalLegacyPpt("Hiring plan review"));
  assert.match(result, /Hiring plan review/);
});

test("packFromFiles indexes a legacy .ppt", async () => {
  const loaded = await packFromFiles([new File([minimalLegacyPpt("Migration rollback criteria")], "plan.ppt")]);
  assert.deepEqual(loaded.failed, []);
  assert.equal(loaded.pack.files.length, 1);
  assert.equal(loaded.pack.files[0]?.language, "ppt");
  assert.match(loaded.pack.files[0]?.content ?? "", /Migration rollback criteria/);
});

test("parsePpt accepts PPTX bytes when a deck was saved with a .ppt extension", async () => {
  const result = await parsePpt(minimalPptx("Misnamed deck"));
  assert.match(result, /Misnamed deck/);
});

test("packFromFiles indexes a pptx", async () => {
  const loaded = await packFromFiles([new File([minimalPptx("Beta kickoff deck")], "kickoff.pptx")]);
  assert.equal(loaded.failed.length, 0);
  assert.equal(loaded.pack.files.length, 1);
  assert.match(loaded.pack.files[0]?.content ?? "", /Beta kickoff deck/);
});

test("parseXlsx extracts CSV text", async () => {
  const csv = new TextEncoder().encode("Name,Role\nAlice,Engineer\n");
  const result = await parseXlsx(bytesToBuffer(csv));
  assert.match(result, /Name \| Role/);
  assert.match(result, /Alice \| Engineer/);
});

test("officeReadError names the file", () => {
  assert.equal(
    officeReadError(["syllabus.docx"]),
    "Could not read syllabus.docx. It may be corrupted or password-protected.",
  );
});

test("officeReadError ignores Word lock files", () => {
  assert.equal(officeReadError(["~$ovare_Labs_AI_User_Guide.docx"]), null);
  assert.equal(
    officeReadError(["~$ovare_Labs_AI_User_Guide.docx", "syllabus.docx"]),
    "Could not read syllabus.docx. It may be corrupted or password-protected.",
  );
});

test("packFromFiles indexes xlsx and csv", async () => {
  const loaded = await packFromFiles([
    new File([xlsxBuffer()], "roster.xlsx"),
    new File(["Name,Role\nAlice,Engineer\n"], "roster.csv", { type: "text/csv" }),
  ]);
  assert.equal(loaded.failed.length, 0);
  const xlsx = loaded.pack.files.find((file) => file.path.endsWith("roster.xlsx"));
  const csv = loaded.pack.files.find((file) => file.path.endsWith("roster.csv"));
  assert.ok(xlsx);
  assert.ok(csv);
  assert.match(xlsx.content, /Alice \| Engineer/);
  assert.match(csv.content, /Alice \| Engineer/);
});

test("packFromFiles indexes a docx", async () => {
  const loaded = await packFromFiles([new File([minimalDocx("Midterm is week 7")], "syllabus.docx")]);
  assert.equal(loaded.failed.length, 0);
  assert.equal(loaded.pack.files.length, 1);
  assert.match(loaded.pack.files[0]?.content ?? "", /Midterm is week 7/);
});

test("packFromFiles silently skips Word lock files", async () => {
  const loaded = await packFromFiles([
    new File(["export const RETRIES = 3\n"], "src/retry.ts", { type: "text/plain" }),
    new File([new Uint8Array([1, 2, 3, 4])], "~$ovare_Labs_AI_User_Guide.docx"),
  ]);
  assert.ok(loaded.pack.files.some((file) => file.path.endsWith("retry.ts")));
  assert.deepEqual(loaded.failed, []);
});

test("corrupted office files are skipped and named", async () => {
  const loaded = await packFromFiles([
    new File(["export const RETRIES = 3\n"], "src/retry.ts", { type: "text/plain" }),
    new File([new Uint8Array([1, 2, 3, 4])], "broken.docx"),
  ]);
  assert.ok(loaded.pack.files.some((file) => file.path.endsWith("retry.ts")));
  assert.equal(loaded.pack.files.some((file) => file.path.endsWith(".docx")), false);
  assert.deepEqual(loaded.failed, ["broken.docx"]);
});

test("office-only packs are not treated as weak", () => {
  const pruned = prunePack({
    id: "notes",
    name: "notes",
    description: "Local folder · 1 files",
    commits: [],
    files: [{ path: "syllabus.docx", language: "docx", content: "Office hours Thursday" }],
  });
  assert.equal(pruned.weak, false);
  assert.equal(pruned.pack.files.length, 1);
});

test("parsed office files persist and index through the existing pipeline", async () => {
  const loaded = await packFromFiles([
    new File([minimalDocx("Office hours are Thursday at 3pm")], "syllabus.docx"),
    new File([xlsxBuffer()], "roster.xlsx"),
    new File(["Name,Role\nAlice,Engineer\n"], "roster.csv", { type: "text/csv" }),
  ]);
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(loaded.pack, repo);
  const hydrated = await indexContext(repo, context.id);
  const paths = hydrated.chunks
    .map((chunk) => ("path" in chunk ? chunk.path : ""))
    .filter(Boolean);
  assert.ok(paths.some((path) => path.endsWith("syllabus.docx")));
  assert.ok(paths.some((path) => path.endsWith("roster.xlsx")));
  assert.ok(paths.some((path) => path.endsWith("roster.csv")));
  assert.ok(hydrated.chunks.some((chunk) => "text" in chunk && /Thursday/.test(chunk.text)));
  assert.ok(hydrated.chunks.some((chunk) => "text" in chunk && /Alice/.test(chunk.text)));
});

test("docx indexes and retrieves definition content", async () => {
  const { buildChunks, retrieve } = await import("../../../search/retrieve.ts");
  const { localCard } = await import("../../../search/local-card.ts");
  const body =
    "Bernoulli's principle states that an increase in the speed of a fluid occurs simultaneously with a decrease in pressure.";
  const loaded = await packFromFiles([new File([minimalDocx(body)], "fluids.docx")]);
  assert.equal(loaded.failed.length, 0);
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(loaded.pack, repo);
  const hydrated = await indexContext(repo, context.id);
  assert.ok(
    hydrated.chunks.some((chunk) => "text" in chunk && /Bernoulli/.test(chunk.text)),
    "expected Bernoulli text in indexed chunks",
  );
  const hits = retrieve("What is Bernoulli's principle?", buildChunks(hydrated.pack));
  assert.ok(hits.length > 0, "expected retrieval hits for Bernoulli's principle");
  const card = localCard("What is Bernoulli's principle?", hits, hydrated.pack, 0, null);
  assert.ok(card.say, `expected a spoken answer, got reason: ${card.reason ?? "none"}`);
  assert.match(card.say ?? "", /Bernoulli/i);
});

test("legacy ppt indexes and retrieves engineering slide content", async () => {
  const { buildChunks, retrieve } = await import("../../../search/retrieve.ts");
  const { localCard } = await import("../../../search/local-card.ts");
  const slide =
    "Volta's law states that the total voltage around a closed loop equals the sum of the voltage drops.";
  const loaded = await packFromFiles([new File([minimalLegacyPpt(slide)], "circuits.ppt")]);
  assert.equal(loaded.failed.length, 0);
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(loaded.pack, repo);
  const hydrated = await indexContext(repo, context.id);
  assert.ok(
    hydrated.chunks.some((chunk) => "text" in chunk && /Volta/.test(chunk.text)),
    "expected Volta text in indexed chunks",
  );
  const hits = retrieve("What is Volta's law?", buildChunks(hydrated.pack));
  assert.ok(hits.length > 0, "expected retrieval hits for Volta's law");
  const card = localCard("What is Volta's law?", hits, hydrated.pack, 0, null);
  assert.ok(card.say, `expected a spoken answer, got reason: ${card.reason ?? "none"}`);
  assert.match(card.say ?? "", /Volta/i);
});

test("pptx indexes and retrieves engineering slide content", async () => {
  const { buildChunks, retrieve } = await import("../../../search/retrieve.ts");
  const { localCard } = await import("../../../search/local-card.ts");
  const slide =
    "Pascal's law states that pressure applied to a confined fluid is transmitted equally in all directions throughout the fluid.";
  const loaded = await packFromFiles([new File([minimalPptx(slide)], "fluids.pptx")]);
  assert.equal(loaded.failed.length, 0);
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(loaded.pack, repo);
  const hydrated = await indexContext(repo, context.id);
  assert.ok(
    hydrated.chunks.some((chunk) => "text" in chunk && /Pascal/.test(chunk.text)),
    "expected Pascal text in indexed chunks",
  );
  const hits = retrieve("What is Pascal's law?", buildChunks(hydrated.pack));
  assert.ok(hits.length > 0, "expected retrieval hits for Pascal's law");
  const card = localCard("What is Pascal's law?", hits, hydrated.pack, 0, null);
  assert.ok(card.say, `expected a spoken answer, got reason: ${card.reason ?? "none"}`);
  assert.match(card.say ?? "", /Pascal/i);
});
