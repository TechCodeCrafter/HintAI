import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { USE_HYBRID_RETRIEVAL } from "../../context/index-versions.ts";
import type { Chunk } from "../../repo/types.ts";
import { bagEmbedding384, setEmbedderForTests } from "../embedding.ts";
import { retrieveStructural } from "../hybrid.ts";
import { hybridRetrieve, retrieve, retrieveHits } from "../retrieve.ts";
import { combineScores, RETRIEVAL_WEIGHTS } from "../retrieval-weights.ts";
import { formatRetrievalSummary, retrievalTraces, traceRetrieval } from "../retrieval-trace.ts";
import { semanticRetrieve } from "../semantic-retrieve.ts";
import { createMemoryVectorStore } from "../vector-store.ts";

afterEach(() => {
  setEmbedderForTests(null);
  traceRetrieval(false);
});

function chunk(id: string, path: string, text: string, extra: Partial<Chunk> = {}): Chunk {
  return {
    id,
    kind: "code",
    path,
    startLine: 1,
    endLine: 4,
    startOffset: 0,
    text,
    ...extra,
  };
}

test("USE_HYBRID_RETRIEVAL is on by default", () => {
  assert.equal(USE_HYBRID_RETRIEVAL, true);
});

test("lexical-only query returns the same hits as retrieve()", async () => {
  const chunks = [
    chunk("a", "src/upload.ts", "Generate a presigned S3 URL for the upload."),
    chunk("b", "src/export.ts", "Write the rows into a workbook and return the bytes."),
  ];
  const query = "Where does document upload happen?";
  const store = createMemoryVectorStore();
  const hybrid = await hybridRetrieve(query, chunks, store);
  assert.deepEqual(
    hybrid.map((h) => h.id),
    retrieve(query, chunks).map((h) => h.id),
  );
});

test("semantic path finds hits lexical missed", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const stored = chunk(
    "store",
    "src/s3.ts",
    "Objects land in the merchant prefix after the gateway accepts the file.",
  );
  const other = chunk("other", "src/format.ts", "Column order locked for finance imports.");
  const chunks = [stored, other];
  const store = createMemoryVectorStore();
  await store.set([
    { chunkId: "store", embedding: bagEmbedding384(stored.text), contentHash: "s" },
    { chunkId: "other", embedding: bagEmbedding384(other.text), contentHash: "o" },
  ]);

  const query = "Where do accepted files land after the gateway?";
  const semantic = await semanticRetrieve(query, chunks, store, 2);
  assert.ok(semantic.some((h) => h.id === "store"), `semantic: ${semantic.map((h) => h.id)}`);

  const hybrid = await hybridRetrieve(query, chunks, store, 2);
  assert.ok(hybrid.some((h) => h.id === "store"));
  assert.ok(hybrid.every((h) => chunks.some((c) => c.id === h.id && c.text === h.text)));
});

test("union deduplicates by chunk id", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const upload = chunk("u", "src/upload.ts", "Generate a presigned S3 URL for the upload.");
  const chunks = [upload];
  const store = createMemoryVectorStore();
  await store.set([{ chunkId: "u", embedding: bagEmbedding384(upload.text + " upload"), contentHash: "u" }]);
  const hybrid = await hybridRetrieve("Where does document upload happen?", chunks, store, 6);
  assert.equal(hybrid.filter((h) => h.id === "u").length, 1);
});

test("combined score uses RETRIEVAL_WEIGHTS", () => {
  assert.equal(combineScores(10, 5), 10 * RETRIEVAL_WEIGHTS.lexical + 5 * RETRIEVAL_WEIGHTS.semantic);
  assert.equal(RETRIEVAL_WEIGHTS.lexical, 1);
  assert.equal(RETRIEVAL_WEIGHTS.semantic, 0.8);
});

test("hybrid traces carry lexical and semantic scores", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  traceRetrieval(true);
  const upload = chunk("u", "src/upload.ts", "Generate a presigned S3 URL for the upload.");
  const store = createMemoryVectorStore();
  await store.set([{ chunkId: "u", embedding: bagEmbedding384(upload.text), contentHash: "u" }]);
  await hybridRetrieve("Where does document upload happen?", [upload], store, 6);
  const traces = retrievalTraces();
  assert.ok(traces.length > 0);
  assert.ok(traces.some((t) => t.chunkId === "u" && t.signals.includes("lexical")));
});

test("semantic channel surfaces Entra trust that never says authentication", async () => {
  setEmbedderForTests(async (text) => {
    const lower = text.toLowerCase();
    const vec = new Array(384).fill(0);
    if (
      lower.includes("authentication") ||
      lower.includes("entra") ||
      lower.includes("bearer") ||
      lower.includes("x-user-email") ||
      lower.includes("msal")
    ) {
      vec[0] = 1;
      return vec;
    }
    return bagEmbedding384(text);
  });
  const boilerplate = chunk(
    "docs",
    "docs/API_DOCUMENTATION.md",
    "## Authentication\nCurrently no authentication. Future versions will implement API Key/JWT/OAuth 2.0.",
  );
  const impl = chunk(
    "impl",
    "api/main.py",
    "Identity is the X-User-Email header. Entra issues a Bearer token; MSAL validates it before the handler runs.",
  );
  const other = chunk("other", "src/format.ts", "Column order locked for finance imports.");
  const chunks = [boilerplate, impl, other];
  const store = createMemoryVectorStore();
  const { embedText } = await import("../embedding.ts");
  await store.set([
    { chunkId: "docs", embedding: await embedText(boilerplate.text), contentHash: "d" },
    { chunkId: "impl", embedding: await embedText(impl.text), contentHash: "i" },
    { chunkId: "other", embedding: await embedText(other.text), contentHash: "o" },
  ]);

  const semantic = await semanticRetrieve("How does authentication work in this backend?", chunks, store, 4);
  assert.ok(semantic.some((hit) => hit.id === "impl"), `semantic: ${semantic.map((hit) => hit.id)}`);

  const hybrid = await hybridRetrieve("How does authentication work in this backend?", chunks, store, 4);
  assert.ok(hybrid.some((hit) => hit.id === "impl"));
  const implHit = hybrid.find((hit) => hit.id === "impl");
  assert.ok((implHit?.semanticScore ?? 0) > 0);
});

test("embedding failure degrades to lexical retrieve", async () => {
  setEmbedderForTests(async () => {
    throw new Error("no key");
  });
  const retry = chunk("retry", "src/retry.ts", "Attempts are capped at three because the gateway stalls.");
  const other = chunk("other", "src/format.ts", "Column order locked for finance imports.");
  const store = createMemoryVectorStore();
  await store.set([
    { chunkId: "retry", embedding: bagEmbedding384(retry.text), contentHash: "r" },
    { chunkId: "other", embedding: bagEmbedding384(other.text), contentHash: "o" },
  ]);
  const query = "Why does that retry three times?";
  const hits = await hybridRetrieve(query, [retry, other], store, 4);
  assert.ok(hits.some((hit) => hit.id === "retry"));
  assert.ok(hits.every((hit) => hit.id === "retry" || hit.id === "other"));
});

test("retrieval summary names channels and the top hit", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const upload = chunk("u", "src/upload.ts", "Generate a presigned S3 URL for the upload.");
  const store = createMemoryVectorStore();
  await store.set([{ chunkId: "u", embedding: bagEmbedding384(upload.text), contentHash: "u" }]);
  const hits = await retrieveHits("Where does document upload happen?", [upload], 2, store, true);
  const summary = formatRetrievalSummary(hits);
  assert.match(summary, /\d+ hits \|/);
  assert.match(summary, /semantic|lexical/);
  assert.match(summary, /top: src\/upload\.ts \(code,/);
});

test("structural retrieve matches a named file and a symbol", () => {
  const chunks = [
    chunk("fn", "src/auth/flow.ts", "export async function runAuthFlow() {}", { symbol: "runAuthFlow" }),
    chunk("other", "src/export.ts", "export function mapRow() {}"),
  ];
  assert.equal(retrieveStructural("what does flow.ts do?", chunks)[0].id, "fn");
  assert.equal(retrieveStructural("where is runAuthFlow?", chunks)[0].id, "fn");
});
