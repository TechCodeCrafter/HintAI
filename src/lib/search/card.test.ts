import assert from "node:assert/strict";
import { test } from "node:test";
import { NORTHSTAR } from "../repo/northstar.ts";
import { architectureCard } from "./architecture.ts";
import { localCard } from "./local-card.ts";
import { buildChunks, retrieve } from "./retrieve.ts";
import type { RepoPack } from "../repo/types.ts";

const CHUNKS = buildChunks(NORTHSTAR);

function ask(query: string) {
  const hits = retrieve(query, CHUNKS);
  return { hits, card: localCard(query, hits, NORTHSTAR, 0, null) };
}

test("an off-topic question produces no Card", () => {
  // Incidental word overlap ("policy") still scores, so the relevance floor —
  // not the presence of hits — is what has to hold the line here.
  for (const query of [
    "What is our parental leave policy?",
    "What is the vacation policy?",
    "Who is the CEO?",
  ]) {
    assert.equal(ask(query).card.say, null, `should stay silent: ${query}`);
  }
});

test("weak evidence scores far below grounded evidence", () => {
  const weak = ask("What is our parental leave policy?").hits[0]?.score ?? 0;
  const strong = ask("Why does that retry three times?").hits[0]?.score ?? 0;
  assert.ok(strong > weak * 3, `grounded ${strong} should dominate incidental ${weak}`);
});

test("a grounded question produces a Card that cites a real loaded file", () => {
  const { hits, card } = ask("Why does that retry three times?");
  assert.ok(hits.length > 0, "retrieval should find evidence");
  assert.ok(card.say, "a grounded question should produce a spoken line");
  assert.ok(card.citations.length > 0, "a Card must cite");
  for (const cite of card.citations) {
    const known =
      NORTHSTAR.files.some((f) => f.path === cite.path) ||
      NORTHSTAR.commits.some((c) => c.files.includes(cite.path));
    assert.ok(known, `citation must point at loaded material: ${cite.path}`);
  }
});

test("the scripted demo answer stays silent without a supporting hit", () => {
  // Same wording the retry branch matches on, but no retrieval behind it.
  const card = localCard("Why does that retry three times?", [], NORTHSTAR, 0, null);
  assert.equal(card.say, null);
});

test("a written architecture answer requires retrieval behind it", () => {
  const quiet = architectureCard(NORTHSTAR, "What is the architecture of this application?", 0, []);
  assert.equal(quiet.say, null);

  const query = "What is the architecture of this application?";
  const grounded = architectureCard(NORTHSTAR, query, 0, retrieve(query, CHUNKS));
  assert.ok(grounded.say, "with evidence it should answer");
  assert.ok(grounded.citations.length > 0);
});

// A multi-component service, shaped like a real loaded backend.
const SERVICE: RepoPack = {
  id: "service-fixture",
  name: "labsai-backend",
  description: "fixture",
  files: [
    {
      path: "api/main.py",
      language: "py",
      content: [
        '"""',
        "FastAPI Main Application",
        "Building...",
        "",
        "REST API for Synthes Biocompatibility Data Extraction System.",
        "",
        "This API provides endpoints for:",
        "- Session management",
        "- Document upload and processing",
        "- Data extraction",
        "- Excel export generation",
        '"""',
        "from fastapi import FastAPI",
        "app = FastAPI()",
      ].join("\n"),
    },
    { path: "container-lambdas/global-rag-compactor/app/lambda_function.py", language: "py", content: "def handler(event, ctx):\n    return compact(event)" },
    { path: "container-lambdas/global-rag-indexer/app/lambda_function.py", language: "py", content: "def handler(event, ctx):\n    return index(event)" },
    { path: "container-lambdas/synthes-chat-agent/app/lambda_function.py", language: "py", content: "def handler(event, ctx):\n    return chat(event)" },
    { path: "container-lambdas/synthes-iceberg-processor/app/aggregator.py", language: "py", content: "def aggregate(rows):\n    return rows" },
    { path: "core/settings.py", language: "py", content: "REGION = 'us-east-1'" },
  ],
  commits: [],
};

test("architecture answer leads with purpose, then structure", () => {
  const card = architectureCard(SERVICE, "How does this application work end to end?", 0, []);
  assert.ok(card.say, "a described service should answer");

  assert.match(card.say, /FastAPI/, "should identify the framework");
  assert.match(card.say, /Biocompatibility Data Extraction/, "should say what it does");
  assert.match(card.say, /four container lambdas/, "structure follows as a second clause");

  // Purpose has to come first, and the tree must not lead.
  const purposeAt = card.say.indexOf("Biocompatibility");
  const structureAt = card.say.indexOf("Work is split");
  assert.ok(purposeAt < structureAt, `purpose must precede structure: ${card.say}`);
  assert.doesNotMatch(card.say, /^\S+ is a \S+ service — Work/, "must not open with the tree");
  assert.doesNotMatch(card.say, /FastAPI Main Application/, "must not read a heading as purpose");
  assert.doesNotMatch(card.say, /Building/, "must not read a placeholder heading");

  const paths = card.citations.map((c) => c.path);
  assert.ok(paths.includes("api/main.py"), "must cite the file the purpose came from");
  for (const path of paths) {
    assert.ok(
      SERVICE.files.some((file) => file.path === path),
      `citation must be a loaded file: ${path}`,
    );
  }
});

test("a citation label is provenance, never a repeat of the path", () => {
  const card = architectureCard(SERVICE, "How does this application work end to end?", 0, []);
  for (const cite of card.citations) {
    assert.notEqual(cite.label, cite.path, "label must not echo the path");
    assert.doesNotMatch(cite.label, /\.(py|ts|tsx|js)(:\d+)?$/, `label looks like a path: ${cite.label}`);
  }
  // The demo pack does have history, so there the label carries it.
  const demo = architectureCard(NORTHSTAR, "What is the architecture of this application?", 0, [
    { kind: "code", path: "src/exporter/retry.ts", startLine: 1, endLine: 1, text: "", id: "x", score: 9 },
  ]);
  assert.ok(demo.citations.every((c) => c.label.length > 0), "provenance exists in the demo pack");
});

test("a truncated capability list does not say 'and' before 'plus N more'", () => {
  const many: RepoPack = {
    ...SERVICE,
    id: "many-fixture",
    files: SERVICE.files.map((f) =>
      f.path === "api/main.py"
        ? {
            ...f,
            content: [
              '"""',
              "Ingest API",
              "",
              "This service ingests lab documents.",
              "",
              "- Session management",
              "- Document upload",
              "- Data extraction",
              "- Excel export",
              "- Audit logging",
              "- Retry handling",
              '"""',
              "from fastapi import FastAPI",
            ].join("\n"),
          }
        : f,
    ),
  };
  const card = architectureCard(many, "How does this application work end to end?", 0, []);
  assert.ok(card.say);
  assert.match(card.say, /plus two more/, "should account for the remainder");
  assert.doesNotMatch(card.say, /and [^.]*, plus/, `dangling "and" before the remainder: ${card.say}`);
});

test("no stated purpose means silence, not a folder listing", () => {
  const bare: RepoPack = {
    ...SERVICE,
    id: "bare-fixture",
    files: SERVICE.files.map((f) =>
      f.path === "api/main.py"
        ? { ...f, content: "from fastapi import FastAPI\napp = FastAPI()" }
        : f,
    ),
  };
  const card = architectureCard(bare, "How does this application work end to end?", 0, []);
  assert.equal(card.say, null, `should stay silent, got: ${card.say}`);
  assert.equal(card.citations.length, 0);
});

// A backend with prose on the routes, the way a real service documents itself.
const ROUTES: RepoPack = {
  id: "routes-fixture",
  name: "labsai-backend",
  description: "fixture",
  files: [
    {
      path: "api/routes/upload.py",
      language: "py",
      content: [
        '"""',
        "Document upload routes.",
        "",
        "Accepts a PDF or DOCX file, stores it in S3 under the session prefix, and",
        "queues a Bedrock Data Automation job for the document.",
        '"""',
        "async def upload_document(session_id, file):",
        "    return queue_bda_job(session_id, store_in_s3(session_id, file))",
      ].join("\n"),
    },
    {
      path: "api/main.py",
      language: "py",
      content: [
        '"""',
        "REST API for Synthes Biocompatibility Data Extraction System.",
        "",
        "This API provides endpoints for:",
        "- Session management",
        "- Document upload and processing",
        "- Excel export generation",
        '"""',
        "from fastapi import FastAPI",
      ].join("\n"),
    },
  ],
  commits: [],
};

function askRoutes(query: string) {
  const hits = retrieve(query, buildChunks(ROUTES));
  return localCard(query, hits, ROUTES, 0, null);
}

test("a Card states the claim, never where to look", () => {
  const queries = [
    "How does document upload work?",
    "Why does that retry three times?",
    "What did we change in the exporter?",
    "How does retrieval score the chunks?",
  ];
  const cards = [...queries.map((q) => ask(q).card), askRoutes("How does document upload work?")];
  for (const card of cards) {
    if (!card.say) continue;
    assert.doesNotMatch(card.say, /\blook at\b/i, `points instead of answering: ${card.say}`);
    assert.doesNotMatch(
      card.say,
      /^(that's handled in|that lives in|this is handled in|see )/i,
      `location-first opening: ${card.say}`,
    );
    assert.doesNotMatch(card.say, /\.(ts|tsx|py|js|mjs)\b/, `speaks a filename: ${card.say}`);
  }
});

test("the claim is read from the file that answers, not the entry point", () => {
  const card = askRoutes("How does document upload work?");
  assert.ok(card.say, "a documented route should answer");
  assert.match(card.say, /Accepts a PDF or DOCX file/, "should speak the route's own prose");
  assert.equal(card.citations[0].path, "api/routes/upload.py", "must cite where the claim was read");
  // The whole-API capability list is the generic answer; it must not win here.
  assert.doesNotMatch(card.say, /provides endpoints for/i, `generic list beat the specific answer: ${card.say}`);
});

test("a claim is never cut mid-sentence", () => {
  const card = askRoutes("How does document upload work?");
  assert.ok(card.say);
  assert.match(card.say, /[.!?]$/, `unterminated claim: ${card.say}`);
  assert.doesNotMatch(card.say, /\b(and|or|the|a|with|for|to|of|using)$/i, "dangling connective");
});

test("evidence that answers nothing produces silence", () => {
  // "session" is in the material, so this retrieves — but no prose answers it.
  for (const query of ["What is the parental leave policy?", "Who owns the vacation calendar?"]) {
    const card = askRoutes(query);
    assert.equal(card.say, null, `should stay silent: ${query} → ${card.say}`);
  }
});

test("a Card never opens with source narration", () => {
  const queries = [
    "Why does that retry three times?",
    "What did we change in the exporter?",
    "Who touched the auth flow?",
    "What is the architecture of this application?",
  ];
  for (const query of queries) {
    const { card } = ask(query);
    if (!card.say) continue;
    assert.doesNotMatch(
      card.say,
      /^(based on|according to|it appears|the (documentation|repo|repository|code) (suggests|shows))/i,
      `filler opening in: ${card.say}`,
    );
  }
});
