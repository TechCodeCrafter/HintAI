import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { persistPackAsContext, setContextRepository } from "../../../context/service.ts";
import { packFromFiles } from "../../../repo/folder.ts";
import { createMemoryRepository } from "../../../context/memory.ts";
import { commitStagedPdfs, pdfWorkPending } from "../../../context/source-write.ts";
import { isPdfSource, isTextSource } from "../../../context/types.ts";
import { hashBlob } from "../../../context/hash.ts";
import { indexContext } from "../../../context/chunk-index.ts";
import { localCard } from "../../../search/local-card.ts";
import { retrieve } from "../../../search/retrieve.ts";
import { shouldRefine } from "../../../search/refine-payload.ts";
import { isDocumentCitation } from "../../../search/cite.ts";
import type { RepoPack } from "../../../repo/types.ts";
import { acceptPdfFile, looksLikePdf } from "../accept.ts";
import { DUPLICATE_NAME_NOTE, planPdfBatch } from "../add-files.ts";
import { finishPdfIngest, resumePdfWork } from "../ingest-flow.ts";
import { contextNameForPdfs, pdfSourceStatus, userFacingPdfNote } from "../source-status.ts";
import { EVAL_PDF_FIXTURES } from "../eval-fixtures.ts";
import { PDF_LIMITS } from "../limits.ts";

const TEXT_PACK: RepoPack = {
  id: "unused",
  name: "payments-backend",
  description: "Local folder · 1 files",
  commits: [],
  files: [
    {
      path: "src/retry.ts",
      language: "ts",
      content: "/** Renew the quorum lease. */\nexport const RETRIES = 3\n",
    },
  ],
};

function pdfFile(name: string, bytes: Uint8Array, type = "application/pdf"): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type });
}

afterEach(() => {
  setContextRepository(null);
});

test("PDF file accepted and non-PDF rejected before parse", async () => {
  const lecture = pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]);
  assert.equal((await acceptPdfFile(lecture, { pdfCount: 0, pdfBytes: 0, replacingExisting: false })).ok, true);
  assert.equal(await looksLikePdf(lecture), true);

  const renamed = pdfFile("notes.pdf", new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  const refused = await acceptPdfFile(renamed, { pdfCount: 0, pdfBytes: 0, replacingExisting: false });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "not-pdf");

  const docx = pdfFile("notes.docx", EVAL_PDF_FIXTURES["lecture.pdf"]);
  const wrongExt = await acceptPdfFile(docx, { pdfCount: 0, pdfBytes: 0, replacingExisting: false });
  assert.equal(wrongExt.ok, false);
});

test("oversized PDF is refused before storage", async () => {
  const huge = pdfFile("huge.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]);
  Object.defineProperty(huge, "size", { value: PDF_LIMITS.maxBytesPerPdf + 1 });
  const result = await acceptPdfFile(huge, { pdfCount: 0, pdfBytes: 0, replacingExisting: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too-large");
});

test("duplicate display names in one batch are rejected", async () => {
  const first = pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]);
  const second = pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["paper.pdf"]);
  const plan = await planPdfBatch([first, second], []);
  assert.equal(plan.accepted.length, 1);
  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0].note, DUPLICATE_NAME_NOTE);
  assert.equal(plan.contextName, "lecture");
});

test("multiple selected PDFs keep Documents as the context name", async () => {
  const plan = await planPdfBatch(
    [
      pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]),
      pdfFile("paper.pdf", EVAL_PDF_FIXTURES["paper.pdf"]),
    ],
    [],
  );
  assert.equal(plan.accepted.length, 2);
  assert.equal(plan.contextName, "Documents");
});

test("Add PDF without a Context creates one and stages the file", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const plan = await planPdfBatch([pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"])], []);
  const context = await repo.createContext({ name: plan.contextName });
  assert.match(context.id, /^[0-9a-f-]{36}$/i);
  const written = await repo.upsertSources(context.id, plan.accepted.map((item) => item.draft));
  assert.equal(written.length, 1);
  assert.ok(isPdfSource(written[0]));
  assert.equal(written[0].path, "lecture.pdf");
  assert.equal(written[0].readiness, "pending");
  const finished = await finishPdfIngest(repo, context.id);
  assert.equal(finished.cancelled, false);
  const ready = finished.sources[0];
  assert.ok(isPdfSource(ready));
  assert.equal(ready.readiness, "ready");
  assert.ok(finished.runtime?.chunks.some((chunk) => chunk.kind === "document"));
});

test("PDF upsert preserves existing text sources", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(TEXT_PACK, repo);
  const plan = await planPdfBatch([pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"])], await repo.listSources(context.id));
  await repo.upsertSources(context.id, plan.accepted.map((item) => item.draft));
  await finishPdfIngest(repo, context.id);
  const sources = await repo.listSources(context.id);
  assert.ok(sources.some((row) => isTextSource(row) && row.path === "src/retry.ts"));
  assert.ok(sources.some((row) => isPdfSource(row) && row.path === "lecture.pdf" && row.readiness === "ready"));
});

test("same path + same hash is a no-op and does not reparse", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const file = pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]);
  const first = await repo.upsertSources(context.id, [{ path: "lecture.pdf", kind: "pdf", blob: file }]);
  await finishPdfIngest(repo, context.id);
  const ready = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(ready));
  const second = await repo.upsertSources(context.id, [{ path: "lecture.pdf", kind: "pdf", blob: file }]);
  assert.equal(second[0].id, first[0].id);
  assert.ok(isPdfSource(second[0]));
  assert.equal(second[0].contentHash, ready.contentHash);
  assert.equal(second[0].updatedAt, ready.updatedAt);
  assert.equal(pdfWorkPending(second), false);
});

test("replacement keeps OLD_HASH searchable until the new snapshot is complete", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  await repo.upsertSources(context.id, [
    { path: "lecture.pdf", kind: "pdf", blob: pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]) },
  ]);
  const first = await finishPdfIngest(repo, context.id);
  const old = first.sources[0];
  assert.ok(isPdfSource(old));
  const oldHash = old.contentHash;
  const oldChunks = first.runtime?.chunks.filter((chunk) => chunk.kind === "document") ?? [];
  assert.ok(oldChunks.length > 0);

  await repo.upsertSources(context.id, [
    { path: "lecture.pdf", kind: "pdf", blob: pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture-multi.pdf"]) },
  ]);
  const staged = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(staged));
  assert.equal(staged.contentHash, oldHash);
  assert.ok(staged.stagedContentHash);
  assert.notEqual(staged.stagedContentHash, oldHash);

  const live = await indexContext(repo, context.id);
  assert.deepEqual(
    live.chunks.filter((chunk) => chunk.kind === "document").map((chunk) => chunk.contentHash),
    oldChunks.map((chunk) => chunk.contentHash),
  );

  const swapped = await finishPdfIngest(repo, context.id);
  const next = swapped.sources[0];
  assert.ok(isPdfSource(next));
  assert.equal(next.contentHash, staged.stagedContentHash);
  assert.equal(next.stagedContentHash, undefined);
  assert.equal(next.readiness, "ready");
});

test("failed replacement keeps OLD_HASH and records the failed update", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  await repo.upsertSources(context.id, [
    { path: "lecture.pdf", kind: "pdf", blob: pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]) },
  ]);
  const first = await finishPdfIngest(repo, context.id);
  const old = first.sources[0];
  assert.ok(isPdfSource(old));

  await repo.upsertSources(context.id, [
    { path: "lecture.pdf", kind: "pdf", blob: pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["unreadable.pdf"]) },
  ]);
  const done = await finishPdfIngest(repo, context.id);
  const live = done.sources[0];
  assert.ok(isPdfSource(live));
  assert.equal(live.contentHash, old.contentHash);
  assert.equal(live.readiness, "ready");
  assert.equal(live.stagedContentHash, undefined);
  assert.equal(live.lastFailedReadiness, "unreadable");
  assert.ok(live.lastFailedHash);
  assert.notEqual(live.lastFailedHash, old.contentHash);
  const status = pdfSourceStatus(live);
  assert.match(status.detail, /couldn't read/i);
  assert.equal(pdfWorkPending([live]), false);
});

test("batch scanned + ready + unreadable activate independently", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "Documents" });
  const plan = await planPdfBatch(
    [
      pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]),
      pdfFile("scanned.pdf", EVAL_PDF_FIXTURES["scanned.pdf"]),
      pdfFile("broken.pdf", EVAL_PDF_FIXTURES["unreadable.pdf"]),
    ],
    [],
  );
  await repo.upsertSources(context.id, plan.accepted.map((item) => item.draft));
  const done = await finishPdfIngest(repo, context.id);
  const byPath = new Map(done.sources.filter(isPdfSource).map((row) => [row.path, row]));
  assert.equal(byPath.get("lecture.pdf")?.readiness, "ready");
  assert.equal(byPath.get("scanned.pdf")?.readiness, "scanned");
  assert.equal(byPath.get("broken.pdf")?.readiness, "unreadable");
  assert.ok(done.runtime?.chunks.some((chunk) => chunk.kind === "document" && chunk.path === "lecture.pdf"));
  assert.equal(
    done.runtime?.chunks.filter((chunk) => chunk.path === "scanned.pdf" || chunk.path === "broken.pdf").length,
    0,
  );
  assert.equal(userFacingPdfNote("scanned"), "This PDF appears to contain scanned pages. MeetHint cannot read scanned PDFs yet.");
  assert.equal(userFacingPdfNote("unreadable"), "MeetHint couldn't read this PDF.");
});

test("reload during pending resumes from the staged Blob", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  await repo.upsertSources(context.id, [
    { path: "lecture.pdf", kind: "pdf", blob: pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]) },
  ]);
  const pending = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(pending));
  assert.equal(pending.readiness, "pending");
  assert.ok(await repo.getSourceBlob(pending.id, pending.contentHash));

  const resumed = await resumePdfWork(repo, context.id);
  const ready = resumed.sources[0];
  assert.ok(isPdfSource(ready));
  assert.equal(ready.readiness, "ready");
  assert.equal(ready.chunked, true);
  assert.ok(resumed.runtime?.chunks.some((chunk) => chunk.kind === "document"));
});

test("late ingest completion does not apply when cancelled", async () => {
  const repo = createMemoryRepository();
  const contextA = await repo.createContext({ name: "A" });
  const contextB = await repo.createContext({ name: "B" });
  await repo.upsertSources(contextA.id, [
    { path: "lecture.pdf", kind: "pdf", blob: pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]) },
  ]);
  await repo.upsertSources(contextB.id, [
    { path: "paper.pdf", kind: "pdf", blob: pdfFile("paper.pdf", EVAL_PDF_FIXTURES["paper.pdf"]) },
  ]);
  await finishPdfIngest(repo, contextB.id);

  const late = await finishPdfIngest(repo, contextA.id, { isCancelled: () => true });
  assert.equal(late.cancelled, true);
  assert.equal(late.runtime, null);
  const a = (await repo.listSources(contextA.id))[0];
  assert.ok(isPdfSource(a));
  assert.equal(a.readiness, "ready");
  const b = await repo.listSources(contextB.id);
  assert.ok(isPdfSource(b[0]));
  assert.equal(b[0].path, "paper.pdf");
});

test("manual PDF open target is page 1 with no evidence highlight", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  await repo.upsertSources(context.id, [
    { path: "lecture.pdf", kind: "pdf", blob: pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]) },
  ]);
  const done = await finishPdfIngest(repo, context.id);
  const source = done.sources[0];
  assert.ok(isPdfSource(source));
  const target = { sourceId: source.id, contentHash: source.contentHash, page: 1, evidenceId: "" };
  assert.equal(target.page, 1);
  assert.equal(target.evidenceId, "");
});

test("PDF Card from ingested material never refines through craftCard", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  await repo.upsertSources(context.id, [
    { path: "lecture.pdf", kind: "pdf", blob: pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]) },
  ]);
  const done = await finishPdfIngest(repo, context.id);
  assert.ok(done.runtime);
  const query = "What does serializable isolation prevent?";
  const hits = retrieve(query, done.runtime.chunks);
  const document = await repo.getNormalizedDocument(done.sources[0].id, isPdfSource(done.sources[0]) ? done.sources[0].contentHash : "");
  const card = localCard(query, hits, done.runtime.pack, 1, null, {
    document: () => document ?? undefined,
  });
  assert.ok(card.say);
  assert.ok(card.citations.some(isDocumentCitation));
  assert.equal(shouldRefine(hits, card), false);
});

test("commitStagedPdfs abandons a failed staged revision", () => {
  const now = 10;
  const committed = commitStagedPdfs(
    [
      {
        id: "src",
        contextId: "ctx",
        path: "lecture.pdf",
        kind: "pdf",
        mimeType: "application/pdf",
        byteLength: 12,
        contentHash: "OLD",
        stagedContentHash: "NEW",
        stagedReadiness: "unreadable",
        stagedReadinessNote: "This PDF could not be read.",
        stagedChunked: true,
        readiness: "ready",
        chunked: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    now,
  );
  const source = committed[0];
  assert.ok(isPdfSource(source));
  assert.equal(source.contentHash, "OLD");
  assert.equal(source.readiness, "ready");
  assert.equal(source.stagedContentHash, undefined);
  assert.equal(source.lastFailedHash, "NEW");
  assert.equal(source.lastFailedReadiness, "unreadable");
});

test("folder ingestion still skips PDFs", async () => {
  const files = [
    new File(["export const RETRIES = 3\n"], "src/retry.ts", { type: "text/plain" }),
    pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]),
  ];
  Object.defineProperty(files[0], "webkitRelativePath", { value: "src/retry.ts" });
  Object.defineProperty(files[1], "webkitRelativePath", { value: "docs/lecture.pdf" });
  const loaded = await packFromFiles(files);
  assert.ok(loaded.pack.files.some((file) => file.path.endsWith("retry.ts")));
  assert.equal(loaded.pack.files.some((file) => file.path.endsWith(".pdf")), false);
});

test("refused page-limit PDF is terminal and contributes no chunks", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  await repo.upsertSources(context.id, [
    { path: "refused.pdf", kind: "pdf", blob: pdfFile("refused.pdf", EVAL_PDF_FIXTURES["refused.pdf"]) },
  ]);
  const done = await finishPdfIngest(repo, context.id);
  const source = done.sources[0];
  assert.ok(isPdfSource(source));
  assert.equal(source.readiness, "refused");
  assert.match(userFacingPdfNote("refused", source.readinessNote), /80-page/);
  assert.equal(done.runtime?.chunks.filter((chunk) => chunk.kind === "document").length, 0);
});

test("reload preserves PDF bytes, IR, and source identity", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  await repo.upsertSources(context.id, [
    { path: "lecture.pdf", kind: "pdf", blob: pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]) },
  ]);
  const first = await finishPdfIngest(repo, context.id);
  const source = first.sources[0];
  assert.ok(isPdfSource(source));
  const blob = await repo.getSourceBlob(source.id, source.contentHash);
  const document = await repo.getNormalizedDocument(source.id, source.contentHash);
  assert.ok(blob);
  assert.ok(document);
  assert.equal(document.contentHash, source.contentHash);
  const again = await resumePdfWork(repo, context.id);
  assert.equal(again.sources[0]?.id, source.id);
  assert.ok(isPdfSource(again.sources[0]));
  assert.equal(again.sources[0].contentHash, source.contentHash);
  assert.ok(again.runtime?.chunks.some((chunk) => chunk.kind === "document"));
});

test("same-hash helper still hashes the bytes used for identity", async () => {
  const file = pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]);
  assert.equal(await hashBlob(file), await hashBlob(file));
});

test("context name helper uses the filename without extension", () => {
  assert.equal(contextNameForPdfs([pdfFile("Lecture-08.pdf", EVAL_PDF_FIXTURES["lecture.pdf"])]), "Lecture-08");
  assert.equal(
    contextNameForPdfs([
      pdfFile("a.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]),
      pdfFile("b.pdf", EVAL_PDF_FIXTURES["paper.pdf"]),
    ]),
    "Documents",
  );
});
