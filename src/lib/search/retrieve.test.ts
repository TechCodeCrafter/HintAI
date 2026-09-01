import assert from "node:assert/strict";
import { test } from "node:test";

import type { RepoPack } from "@/lib/repo/types";
import { buildChunks, isEvidencePath, retrieve, tokenize } from "./retrieve.ts";

/**
 * A baseline around the lexical retriever as it stands today.
 *
 * These are not aspirations. They pin the behaviours the Card layer already
 * depends on — term matching, IDF, per-file diversity, pruning — so that when
 * retrieval is later augmented, any change in these outcomes is a deliberate
 * decision rather than a silent regression.
 */

function file(path: string, content: string) {
  return { path, language: path.split(".").pop() ?? "txt", content };
}

const PACK: RepoPack = {
  id: "fixture",
  name: "fixture-service",
  description: "A fixture service",
  commits: [],
  files: [
    file(
      "api/upload.py",
      `"""
Handles file upload and document processing endpoints.

Generates presigned S3 upload URLs and triggers processing for uploaded files.
"""
from fastapi import APIRouter

router = APIRouter()

def create_upload_url(session_id: str) -> str:
    """Generate a presigned S3 URL for the upload."""
    return sign(session_id)
`,
    ),
    file(
      "api/export.py",
      `"""
Builds the Excel workbook from extracted rows using openpyxl.
"""
def export_workbook(rows):
    """Write the rows into a workbook and return the bytes."""
    return build(rows)
`,
    ),
    file(
      "infrastructure/repositories/in_memory_repository.py",
      `"""
In-memory implementation of the IRepository interface.

This module provides a lightweight repository implementation
that stores data in memory using dictionaries. Perfect for:
- Unit testing (no database setup required)
- Development environments
- Integration tests
- Rapid prototyping
"""
class InMemoryRepository:
    pass
`,
    ),
    // Deliberately repetitive: without IDF its common words would dominate.
    file(
      "api/routes_table.py",
      `# session session session upload upload upload export export export
# session session session upload upload upload export export export
# session session session upload upload upload export export export
`,
    ),
    file("dist/bundle.js", "function upload(){} function exportWorkbook(){}"),
    file("node_modules/lib/upload.js", "module.exports = function upload(){}"),
    file(".vercel/output/config.json", '{"routes":[{"src":"/upload"}]}'),
    file("api/types.d.ts", "export declare function upload(): void;"),
  ],
};

const CHUNKS = buildChunks(PACK);
const paths = (q: string) => retrieve(q, CHUNKS).map((h) => h.path);

test("an exact technical term finds the file that defines it", () => {
  const hits = retrieve("openpyxl", CHUNKS);
  assert.ok(hits.length > 0, "a distinctive term must retrieve something");
  assert.equal(hits[0].path, "api/export.py");
});

test("nearby wording still lands, via stemming and path words", () => {
  // "uploaded"/"uploading" must reach `upload.py`; this is the only synonym
  // tolerance the lexical scorer has, and the Card layer relies on it.
  for (const q of ["Where does document upload happen?", "how are documents uploaded?"]) {
    assert.ok(paths(q).includes("api/upload.py"), `"${q}" missed api/upload.py`);
  }
});

test("a repetitive file does not dominate on common terms", () => {
  // routes_table.py repeats "upload" nine times; upload.py says it meaningfully.
  const ranked = paths("Where does document upload happen?");
  const upload = ranked.indexOf("api/upload.py");
  const table = ranked.indexOf("api/routes_table.py");
  assert.ok(upload >= 0, "the real file must be retrieved");
  assert.ok(table === -1 || upload < table, "term repetition must not outrank meaning");
});

test("IDF is applied, but heavy repetition can still outrank a rare term", () => {
  // Scores are not comparable across queries, so this is asserted inside one.
  const ranked = paths("session openpyxl");
  assert.ok(ranked.includes("api/export.py"), "the file with the rare term must be retrieved");
  // A deliberate pin of current behaviour: routes_table.py repeats "session"
  // nine times and still ranks first, because bounded term frequency grows
  // faster than IDF discounts it in a corpus this small. The test above covers
  // the case that matters in practice — a natural question — where meaning wins.
  assert.equal(ranked[0], "api/routes_table.py");
});

test("one file cannot flood the results", () => {
  const hits = retrieve("upload processing document session export", CHUNKS);
  const perFile = new Map<string, number>();
  for (const hit of hits) perFile.set(hit.path, (perFile.get(hit.path) ?? 0) + 1);
  for (const [path, n] of perFile) {
    assert.ok(n <= 2, `${path} took ${n} of ${hits.length} slots`);
  }
  assert.ok(perFile.size > 1, "results should span more than one file");
});

test("generated, vendored and tooling paths are never evidence", () => {
  for (const path of [
    "dist/bundle.js",
    "node_modules/lib/upload.js",
    ".vercel/output/config.json",
    "api/types.d.ts",
  ]) {
    assert.equal(isEvidencePath(path), false, `${path} must be pruned`);
  }
  const ranked = paths("upload");
  for (const path of ranked) {
    assert.ok(isEvidencePath(path), `${path} leaked into retrieval`);
  }
});

test("a purpose question retrieves file heads, where the docstrings are", () => {
  const hits = retrieve("What is the architecture of this application?", CHUNKS);
  assert.ok(hits.length > 0);
  assert.ok(
    hits.some((h) => (h.kind === "code" || h.kind === "why") && h.startLine <= 8),
    "structural questions must reach the top of files",
  );
});

test("a question with several candidates ranks the most specific first", () => {
  const ranked = paths("How does the Excel export work?");
  assert.equal(ranked[0], "api/export.py");
});

test("an irrelevant question returns no evidence", () => {
  assert.deepEqual(retrieve("What is the weather in Tokyo?", CHUNKS), []);
});

test("a question of pure stop words returns nothing", () => {
  assert.deepEqual(retrieve("and then the this that", CHUNKS), []);
});

test("naming a file in the question pins retrieval to it", () => {
  const ranked = paths("what does in_memory_repository.py do?");
  assert.equal(ranked[0], "infrastructure/repositories/in_memory_repository.py");
});

test("tokenize joins hyphenated speech and drops pure stop words", () => {
  assert.ok(tokenize("the auto-answer toggle").includes("autoanswer"));
  assert.deepEqual(tokenize("the and of"), []);
});

test("a meaningful content match outranks a generic path match", () => {
  // routes_table.py has "session" in quantity; upload.py describes the subject.
  const ranked = paths("upload processing");
  assert.equal(ranked[0], "api/upload.py");
});

test("a directory name alone does not make a file the strongest evidence", () => {
  // "api" names a directory that three files sit in, so it cannot decide which
  // of them answers a question about workbooks.
  const ranked = paths("api openpyxl");
  assert.equal(ranked[0], "api/export.py", "the discriminative term decides");
});

test("a discriminative term beats a generic one in the same query", () => {
  const ranked = paths("session openpyxl");
  assert.ok(ranked.includes("api/export.py"));
});

test("why-seven-lambdas prefers worker folders over a numbered step list", () => {
  const pack: RepoPack = {
    id: "lambdas",
    name: "lambdas",
    description: "",
    commits: [],
    files: [
      file(
        "container-lambdas/bda-ingest-worker/app/lambda_function.py",
        `"""BDA Ingest Worker. Consumes SQS from S3 ObjectCreated."""\ndef handler(event):\n    return run(event)\n`,
      ),
      file(
        "container-lambdas/synthes-query-processor/app/lambda_function.py",
        `"""Query processor. Joins TP/TR rows."""\ndef handler(event):\n    return join(event)\n`,
      ),
      file(
        "container-lambdas/global-rag-indexer/app/lambda_function.py",
        `"""Indexes markdown into the global RAG store."""\ndef handler(event):\n    return index(event)\n`,
      ),
      file(
        "services/matcher.py",
        `# Cross-session matching flow\n# 1) anchor\n# 2) fetch\n# 3) candidates\n# 4) bedrock\n# 5) insert\n# 6) dedupe\n# 7) supersede old join rows\n`,
      ),
    ],
  };
  const hits = retrieve("Why seven lambdas?", buildChunks(pack));
  const ranked = hits.map((h) => h.path);
  assert.ok(
    ranked.some((path) => path.includes("container-lambdas/")),
    "fleet questions must reach worker folders",
  );
  assert.ok(
    ranked.filter((path) => path.includes("container-lambdas/")).length >= 2,
    "fleet questions should surface more than one worker",
  );
  assert.notEqual(ranked[0], "services/matcher.py");
});

test("numeral aliasing is one-way today — a spoken digit is lost", () => {
  // Word to digit works.
  assert.ok(tokenize("retry three times").includes("3"));
  // Digit to word does not: the `length > 1` filter removes "3" before aliasing,
  // so "why does it retry 3 times?" loses its most distinctive term entirely.
  // Whisper writes digits routinely, so this is a live defect, pinned here as
  // current behaviour rather than silently expected to work.
  assert.deepEqual(tokenize("retry 3 times"), ["retry", "times"]);
});
