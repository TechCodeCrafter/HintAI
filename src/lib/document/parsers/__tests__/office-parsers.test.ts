import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";

import { persistPackAsContext } from "../../../context/service.ts";
import { createMemoryRepository } from "../../../context/memory.ts";
import { indexContext } from "../../../context/chunk-index.ts";
import { packFromFiles, prunePack } from "../../../repo/folder.ts";
import { officeReadError, parseDocx, parseXlsx } from "../office-parsers.ts";

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
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Name", "Role"],
    ["Alice", "Engineer"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const written = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array);
  return bytesToBuffer(written);
}

test("parseDocx extracts text", async () => {
  const result = await parseDocx(minimalDocx("Office hours Thursday"));
  assert.equal(typeof result, "string");
  assert.match(result, /Office hours Thursday/);
});

test("parseDocx rejects an empty buffer", async () => {
  await assert.rejects(() => parseDocx(new ArrayBuffer(0)));
});

test("parseXlsx extracts sheet text", () => {
  const result = parseXlsx(xlsxBuffer());
  assert.match(result, /Name \| Role/);
  assert.match(result, /Alice \| Engineer/);
});

test("parseXlsx extracts CSV text", () => {
  const csv = new TextEncoder().encode("Name,Role\nAlice,Engineer\n");
  const result = parseXlsx(bytesToBuffer(csv));
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
