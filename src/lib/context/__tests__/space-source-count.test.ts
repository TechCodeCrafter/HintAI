import assert from "node:assert/strict";
import { test } from "node:test";
import { addPdfFilesToContext } from "../../document/pdf/add-files.ts";
import { EVAL_PDF_FIXTURES } from "../../document/pdf/eval-fixtures.ts";
import { authorizedSourceIdsFrom } from "../../search/search-scope.ts";
import { createMemoryRepository } from "../memory.ts";
import { indexSpace } from "../space-index.ts";
import { isPdfSource, isTextSource } from "../types.ts";

test("space source counts track individual files and PDFs rather than retrieval bundle IDs", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "Mixed materials" });

  async function expectCounts(files: number, pdfs: number, bundles: number) {
    const expected = files + pdfs;
    const { allSources } = await indexSpace(repo, context.id, { embed: false });
    assert.equal(allSources.length, expected);
    assert.equal(allSources.filter(isTextSource).length, files);
    assert.equal(allSources.filter(isPdfSource).length, pdfs);
    assert.equal((await repo.getContext(context.id))?.sourceCount, expected);
    assert.equal(await repo.countSources(context.id), expected);
    assert.equal(authorizedSourceIdsFrom(allSources).length, bundles);
    return allSources;
  }

  await expectCounts(0, 0, 0);

  const files = [
    { path: "src/first.ts", language: "ts", content: "export const first = 1;" },
    { path: "src/second.ts", language: "ts", content: "export const second = 2;" },
  ];
  const bundleSourceId = "selected-folder";
  const displayName = "Selected folder";
  await repo.upsertRepoBundle(context.id, { displayName, bundleSourceId, files });
  await expectCounts(2, 0, 1);

  const pdf = new File([new Uint8Array(EVAL_PDF_FIXTURES["lecture.pdf"])], "lecture.pdf", {
    type: "application/pdf",
  });
  const outcome = await addPdfFilesToContext(repo, [pdf], context.id);
  assert.ok(outcome.ingest?.sources.some((source) => isPdfSource(source) && source.readiness === "ready"));
  const mixed = await expectCounts(2, 1, 2);
  await repo.deleteSources(context.id, [mixed.find(isTextSource)!.id]);
  const remaining = await expectCounts(1, 1, 2);
  await repo.deleteSources(context.id, [remaining.find(isTextSource)!.id]);
  const pdfOnly = await expectCounts(0, 1, 1);
  await repo.deleteSources(context.id, [pdfOnly[0].id]);
  await expectCounts(0, 0, 0);
});
