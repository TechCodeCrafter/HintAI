import assert from "node:assert/strict";
import { test } from "node:test";

import type { RepoPack } from "@/lib/repo/types";
import { localCard } from "./local-card.ts";
import { buildChunks, retrieve } from "./retrieve.ts";
import { admissible, provenanceOf, subjectTerms } from "./subject.ts";

/**
 * Admission semantics: a path match locates evidence, it does not make unrelated
 * evidence answerable. The fixture reproduces the real failure — an
 * `application/` directory whose contents say nothing about testing.
 */

function file(path: string, content: string) {
  return { path, language: path.split(".").pop() ?? "txt", content };
}

const PACK: RepoPack = {
  id: "fixture-subject",
  name: "fixture-app",
  description: "fixture",
  commits: [],
  files: [
    // "application" appears in most files, so it is the generic term. "testing"
    // appears nowhere, so nothing can support it.
    file(
      "application/document_processing_pipeline.py",
      `"""
Chains processing steps together using the Chain of Responsibility pattern.

Each step in the application receives the document and passes it along.
"""
class DocumentProcessingPipeline:
    pass
`,
    ),
    file(
      "application/session_service.py",
      `"""
Coordinates chat sessions for the application.
"""
class SessionService:
    pass
`,
    ),
    file(
      "application/excel_output_generator.py",
      `"""
Generates Excel files by writing extracted rows through openpyxl worksheets.
"""
def generate(rows):
    pass
`,
    ),
    file(
      "container-lambdas/bda-ingest-worker/app/bda_client.py",
      `"""
Handles PDF to Markdown conversion using AWS Bedrock Data Automation service.
"""
class Client:
    pass
`,
    ),
    // As in the real repo, "testing" is mentioned once, somewhere unrelated to
    // the question's subject. The word exists; the pipeline evidence still has
    // nothing to do with it.
    file(
      "infrastructure/in_memory_repository.py",
      `"""
Stores data in memory using dictionaries. Perfect for unit testing.
"""
class InMemoryRepository:
    pass
`,
    ),
    file(
      "api/upload.py",
      `"""
Handles file upload endpoints for the application: presigned S3 URLs and
triggering downstream processing.
"""
def handle_upload():
    pass
`,
    ),
  ],
};

const CHUNKS = buildChunks(PACK);
const ask = (q: string) => localCard(q, retrieve(q, CHUNKS), PACK, 0, null);

test("the known regression: a directory name cannot carry an unrelated answer", () => {
  // "application" matches `application/`; "testing" is supported by nothing.
  const card = ask("How are we testing the application?");
  assert.equal(card.say, null, `spoke anyway: ${card.say}`);
});

test("conversational filler cannot lift a directory name into the subject", () => {
  // The live failure: "not" and "all" sit in most files, and counting them as
  // question terms raised the median far enough that "application" — a directory
  // name — qualified as the subject and carried an unrelated answer.
  const terms = ["not", "testing", "application", "all", "right"];
  const subject = subjectTerms(terms, PACK);
  assert.ok(subject.includes("testing"), "the real subject must survive");
  assert.equal(subject.includes("application"), false, "a common term is not the subject");
  assert.equal(subject.includes("all"), false);
  assert.equal(subject.includes("not"), false);
});

test("a challenge about testing stays silent, whatever the filler", () => {
  for (const q of [
    "We're not testing this application at all, right?",
    "How are we testing this application?",
  ]) {
    assert.equal(ask(q).say, null, `spoke anyway: ${q}`);
  }
});

test("a spoken Card cites only where the sentence was read", () => {
  const card = ask("What does the BDA ingest worker do?");
  assert.ok(card.say);
  assert.equal(card.citations.length, 1, "a second file cannot support this sentence");
  assert.equal(card.citations[0].path, "container-lambdas/bda-ingest-worker/app/bda_client.py");
});

test("the generic term is identified by how common it is, not by a word list", () => {
  assert.deepEqual(subjectTerms(["testing", "application"], PACK), ["testing"]);
  // Nothing about the word "application" is special. Here "upload" is the common
  // word and "application" the rare one, and the roles swap.
  const inverted: RepoPack = {
    ...PACK,
    files: [
      file("a/upload_one.py", '"""Handles upload."""'),
      file("b/upload_two.py", '"""Also handles upload."""'),
      file("c/application_config.py", '"""The application config."""'),
    ],
  };
  assert.deepEqual(subjectTerms(["upload", "application"], inverted), ["application"]);
});

test("provenance separates content support from path-only support", () => {
  const p = provenanceOf(
    ["testing", "application"],
    ["testing"],
    "Chains processing steps together using the Chain of Responsibility pattern.",
    "application/document_processing_pipeline.py",
  );
  assert.deepEqual(p.content, [], "the claim mentions neither term");
  assert.deepEqual(p.path, ["application"], "only the path matched");
  assert.deepEqual(p.covered, [], "the subject is unsupported");
  assert.equal(admissible(p), false);
});

test("a path match of a discriminative term is real support", () => {
  // The docstring of `bda-ingest-worker/` describes the worker without repeating
  // its name, which is the honest answer and must stay admissible.
  const card = ask("What does the BDA ingest worker do?");
  assert.ok(card.say, "a named component must still answer");
  assert.match(card.say ?? "", /Bedrock Data Automation/);
});

test("content evidence answers a mechanism question", () => {
  const card = ask("How does the Excel export work?");
  assert.ok(card.say, "mechanism evidence must still answer");
  assert.match(card.say ?? "", /openpyxl|Excel/);
});

test("a WHERE question may lean on the path", () => {
  const card = ask("Where is document upload handled?");
  assert.ok(card.say, "location questions must still answer");
  assert.ok(
    card.citations.some((c) => c.path === "api/upload.py"),
    "and must cite the file that handles it",
  );
});

test("admission needs a subject at all", () => {
  assert.equal(admissible({ content: [], path: [], subject: [], covered: [] }), false);
});

test("a word the material never uses cannot become the subject", () => {
  // "export" appears nowhere in this pack. If it counted as the rarest term it
  // would be unsupportable by construction and silence every export question.
  assert.equal(subjectTerms(["excel", "export"], PACK).includes("export"), false);
  assert.deepEqual(subjectTerms(["excel", "export"], PACK), ["excel"]);
  // A question made only of words the material lacks has no subject to support.
  assert.deepEqual(subjectTerms(["kubernetes", "helm"], PACK), []);
});
