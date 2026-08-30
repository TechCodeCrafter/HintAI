/**
 * Phase 4A.6 ingestion timings. Do not tune the parser.
 *
 * node --experimental-strip-types scripts/pdf-ingest-bench.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createMemoryRepository } from "../src/lib/context/memory.ts";
import { addPdfFilesToContext } from "../src/lib/document/pdf/add-files.ts";
import { EVAL_PDF_FIXTURES } from "../src/lib/document/pdf/eval-fixtures.ts";

function pdfFile(name: string, bytes: Uint8Array): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: "application/pdf" });
}

async function time(label: string, run: () => Promise<unknown>) {
  const started = performance.now();
  await run();
  const ms = Number((performance.now() - started).toFixed(2));
  return { label, ms };
}

const coldRepo = createMemoryRepository();
const cold = {
  lecture: await time("lecture-cold", () =>
    addPdfFilesToContext(coldRepo, [pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"])], null),
  ),
};
const lectureId = (await coldRepo.listContexts())[0]?.id ?? null;

const warm = {
  lecture: await time("lecture-warm-same-hash", () =>
    addPdfFilesToContext(coldRepo, [pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"])], lectureId),
  ),
  multipage: await time("multipage-cold", () =>
    addPdfFilesToContext(coldRepo, [pdfFile("lecture-multi.pdf", EVAL_PDF_FIXTURES["lecture-multi.pdf"])], lectureId),
  ),
  paper: await time("paper-cold", () =>
    addPdfFilesToContext(coldRepo, [pdfFile("paper.pdf", EVAL_PDF_FIXTURES["paper.pdf"])], lectureId),
  ),
};

const batchRepo = createMemoryRepository();
const batch = await time("batch-three", () =>
  addPdfFilesToContext(
    batchRepo,
    [
      pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]),
      pdfFile("lecture-multi.pdf", EVAL_PDF_FIXTURES["lecture-multi.pdf"]),
      pdfFile("paper.pdf", EVAL_PDF_FIXTURES["paper.pdf"]),
    ],
    null,
  ),
);

const report = { cold, warm, batch, at: new Date().toISOString() };
const out = fileURLToPath(new URL("../.eval/phase4a/ingest-timings-4a6.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
