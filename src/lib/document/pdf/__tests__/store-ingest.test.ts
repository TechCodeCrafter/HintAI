import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createMemoryRepository } from "../../../context/memory.ts";
import { persistPackAsContext, setContextRepository } from "../../../context/service.ts";
import { isPdfSource, isTextSource } from "../../../context/types.ts";
import type { RepoPack } from "../../../repo/types.ts";
import { addPdfFilesToContext, planPdfBatch } from "../add-files.ts";
import { EVAL_PDF_FIXTURES } from "../eval-fixtures.ts";

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

function pdfFile(name: string, bytes: Uint8Array): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: "application/pdf" });
}

afterEach(() => {
  setContextRepository(null);
});

test("Add PDF without an active user Context creates one", async () => {
  const repo = createMemoryRepository();
  const outcome = await addPdfFilesToContext(repo, [pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"])], null);
  assert.equal(outcome.created, true);
  assert.ok(outcome.contextId);
  assert.match(outcome.contextId, /^[0-9a-f-]{36}$/i);
  assert.equal(outcome.plan.contextName, "lecture");
  assert.ok(outcome.ingest);
  assert.equal(outcome.ingest.cancelled, false);
  assert.ok(outcome.ingest.sources.some((row) => isPdfSource(row) && row.path === "lecture.pdf" && row.readiness === "ready"));
  const stored = await repo.getContext(outcome.contextId);
  assert.equal(stored?.name, "lecture");
});

test("Add PDF to an existing Context preserves text sources", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(TEXT_PACK, repo);
  const outcome = await addPdfFilesToContext(
    repo,
    [pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"])],
    context.id,
  );
  assert.equal(outcome.created, false);
  assert.equal(outcome.hadSnapshot, true);
  const sources = await repo.listSources(context.id);
  assert.ok(sources.some((row) => isTextSource(row) && row.path === "src/retry.ts"));
  assert.ok(sources.some((row) => isPdfSource(row) && row.path === "lecture.pdf" && row.readiness === "ready"));
});

test("non-PDF selections never create a Context", async () => {
  const repo = createMemoryRepository();
  const fake = new File([new Uint8Array([1, 2, 3, 4])], "notes.pdf", { type: "application/pdf" });
  const outcome = await addPdfFilesToContext(repo, [fake], null);
  assert.equal(outcome.contextId, null);
  assert.equal(outcome.created, false);
  assert.equal((await repo.listContexts()).length, 0);
});

test("late A completion cannot mutate B sources", async () => {
  const repo = createMemoryRepository();
  const a = await addPdfFilesToContext(repo, [pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"])], null);
  assert.ok(a.contextId);
  const b = await addPdfFilesToContext(repo, [pdfFile("paper.pdf", EVAL_PDF_FIXTURES["paper.pdf"])], null);
  assert.ok(b.contextId);

  const late = await addPdfFilesToContext(repo, [pdfFile("notes.pdf", EVAL_PDF_FIXTURES["bullets.pdf"])], a.contextId, {
    isCancelled: () => true,
  });
  assert.equal(late.ingest?.cancelled, true);
  assert.equal(late.ingest?.runtime, null);
  const aSources = await repo.listSources(a.contextId);
  assert.ok(aSources.some((row) => row.path === "notes.pdf"));
  const bSources = await repo.listSources(b.contextId);
  assert.ok(bSources.every((row) => row.path !== "notes.pdf"));
  assert.ok(bSources.some((row) => row.path === "paper.pdf"));
});

test("IndexedDB quota failure does not parse or replace the Context", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(TEXT_PACK, repo);
  const original = repo.upsertSources.bind(repo);
  repo.upsertSources = async () => {
    throw new Error("QuotaExceededError");
  };
  const outcome = await addPdfFilesToContext(repo, [pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"])], context.id);
  repo.upsertSources = original;
  assert.equal(outcome.quotaFailed, true);
  assert.equal(outcome.ingest, null);
  const sources = await repo.listSources(context.id);
  assert.equal(sources.some(isPdfSource), false);
  assert.ok(sources.some(isTextSource));
  assert.equal((await repo.getContext(context.id))?.name, "payments-backend");
});

test("multiple files are queued and planned before upsert", async () => {
  const plan = await planPdfBatch(
    [
      pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]),
      pdfFile("paper.pdf", EVAL_PDF_FIXTURES["paper.pdf"]),
      new File([new Uint8Array([0, 1, 2])], "junk.pdf", { type: "application/pdf" }),
    ],
    [],
  );
  assert.equal(plan.accepted.length, 2);
  assert.equal(plan.rejected.length, 1);
  const repo = createMemoryRepository();
  const outcome = await addPdfFilesToContext(
    repo,
    [pdfFile("lecture.pdf", EVAL_PDF_FIXTURES["lecture.pdf"]), pdfFile("paper.pdf", EVAL_PDF_FIXTURES["paper.pdf"])],
    null,
  );
  assert.equal(outcome.plan.contextName, "Documents");
  assert.equal(outcome.ingest?.sources.filter(isPdfSource).length, 2);
});
