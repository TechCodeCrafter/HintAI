/**
 * Raw PDF.js text dump for Phase 4A.7 human labeling.
 * Does not import parsePdf, normalize, retrieve, or localCard.
 *
 * node --experimental-strip-types scripts/pdf-release-dump.ts
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CORPUS = `${ROOT}.eval/phase4a/release/corpus`;
const DUMPS = `${ROOT}.eval/phase4a/release/dumps`;

const require = createRequire(import.meta.url);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
).href;

mkdirSync(DUMPS, { recursive: true });

function itemsToText(items: Array<{ str?: string }>): string {
  return items
    .map((item) => item.str ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const files = readdirSync(CORPUS)
  .filter((name) => name.endsWith(".pdf"))
  .sort();

const index: Array<{
  file: string;
  bytes: number;
  pages: number | null;
  extractablePages: number;
  rawChars: number;
  encrypted: boolean;
  error: string | null;
}> = [];

for (const file of files) {
  const bytes = readFileSync(`${CORPUS}/${file}`);
  const row = {
    file,
    bytes: bytes.byteLength,
    pages: null as number | null,
    extractablePages: 0,
    rawChars: 0,
    encrypted: false,
    error: null as string | null,
  };
  try {
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      password: "",
      useSystemFonts: true,
      verbosity: 0,
      stopAtErrors: false,
    });
    task.onPassword = () => {
      row.encrypted = true;
      void task.destroy();
    };
    const doc = await task.promise;
    row.pages = doc.numPages;
    const pages: Array<{ page: number; chars: number; text: string }> = [];
    const dumpAll = doc.numPages <= 16;
    const samplePages = new Set<number>([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      Math.min(16, doc.numPages),
      Math.min(20, doc.numPages),
      Math.min(24, doc.numPages),
      Math.min(30, doc.numPages),
      doc.numPages,
    ]);
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = itemsToText(content.items as Array<{ str?: string }>);
      row.rawChars += text.length;
      if (text.length > 20) row.extractablePages += 1;
      if (dumpAll || samplePages.has(pageNumber)) {
        pages.push({ page: pageNumber, chars: text.length, text });
      }
    }
    await doc.cleanup();
    writeFileSync(`${DUMPS}/${basename(file, ".pdf")}.json`, `${JSON.stringify({ file, pages: doc.numPages, rawChars: row.rawChars, extractablePages: row.extractablePages, sample: pages }, null, 2)}\n`);
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
    if (/password/i.test(row.error) || row.encrypted) row.encrypted = true;
    writeFileSync(`${DUMPS}/${basename(file, ".pdf")}.json`, `${JSON.stringify(row, null, 2)}\n`);
  }
  index.push(row);
  console.log(
    `${file}\tpages=${row.pages ?? "?"}\tchars=${row.rawChars}\textractable=${row.extractablePages}\tenc=${row.encrypted}\terr=${row.error ?? ""}`,
  );
}

writeFileSync(`${DUMPS}/_index.json`, `${JSON.stringify(index, null, 2)}\n`);
