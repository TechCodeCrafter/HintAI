import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { demoAnswer } from "../../demo/answer.ts";
import { isSearchDebug } from "../../debug.ts";
import { NORTHSTAR } from "../../repo/northstar.ts";
import type { Chunk, Hit } from "../../repo/types.ts";
import { bagEmbedding384, setEmbedderForTests } from "../embedding.ts";
import { buildChunks, hybridRetrieve, retrieve } from "../retrieve.ts";
import { RETRIEVAL_WEIGHTS } from "../retrieval-weights.ts";
import { createMemoryVectorStore } from "../vector-store.ts";
import {
  buildSearchDebug,
  buildSearchDetails,
  clearSearchDebugLog,
  indexCounts,
  reportSearchDebug,
  SEARCH_DEBUG_TOP,
  SEARCH_DETAILS_TOP,
  searchDebugLog,
  scoreParts,
  snippetOf,
  stageLabel,
  stageOfTier,
} from "../search-debug.ts";

const QUESTION = "Why does that retry three times?";

afterEach(() => {
  setEmbedderForTests(null);
  delete process.env.DEBUG_SEARCH;
  clearSearchDebugLog();
});

/** Runs `fn` and returns what it printed with console.info. */
function printed(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    fn();
  } finally {
    console.info = original;
  }
  return lines;
}

function chunk(id: string, path: string, extra: Partial<Chunk> = {}): Chunk {
  return { id, kind: "code", path, startLine: 1, endLine: 4, startOffset: 0, text: "text", ...extra };
}

test("search debug is off unless the flag is set, and then prints and keeps nothing", () => {
  assert.equal(isSearchDebug(), false);
  const lines = printed(() => {
    const card = demoAnswer(QUESTION);
    assert.ok(card.say, "the answer itself does not depend on the flag");
  });
  assert.deepEqual(lines, []);
  assert.deepEqual(searchDebugLog(), []);
});

test("with the flag on, a search prints the index size, the ranked hits and the stage", () => {
  process.env.DEBUG_SEARCH = "true";
  const chunks = buildChunks(NORTHSTAR);
  const lines = printed(() => demoAnswer(QUESTION));

  const [record] = searchDebugLog();
  assert.equal(searchDebugLog().length, 1);
  assert.equal(record.query, QUESTION);
  assert.equal(record.filesIndexed, new Set(chunks.map((c) => c.path)).size);
  assert.equal(record.chunksIndexed, chunks.length);
  assert.equal(record.stage, "localCard");
  assert.equal(record.reason, null);

  // The listed hits are retrieval's own ranking and scores, best first.
  const ranked = retrieve(QUESTION, chunks, SEARCH_DEBUG_TOP);
  assert.deepEqual(
    record.topHits.map((hit) => [hit.path, hit.score]),
    ranked.map((hit) => [hit.path, Number(hit.score.toFixed(2))]),
  );
  assert.ok(record.topHits.length <= SEARCH_DEBUG_TOP);
  // Every hit the composer was given is marked as sent.
  const sent = retrieve(QUESTION, chunks);
  assert.equal(record.hitsSent, sent.length);
  assert.equal(record.topHits.filter((hit) => hit.sentToAnswer).length, sent.length);

  const text = lines.join("\n");
  assert.match(text, new RegExp(`indexed: ${record.filesIndexed} files, ${record.chunksIndexed} chunks`));
  assert.match(text, /answered by: localCard/);
  assert.match(text, /src\/exporter\/retry\.ts/);
});

test("a question the pack cannot cite is logged as silence, with the reason on the card", () => {
  process.env.DEBUG_SEARCH = "true";
  const lines = printed(() => {
    const card = demoAnswer("What is the weather in Tokyo today?");
    assert.equal(card.say, null);
  });
  const [record] = searchDebugLog();
  assert.equal(record.stage, "silence");
  assert.ok(record.reason);
  assert.match(lines.join("\n"), /answered by: silence/);
});

test("each router tier is named after the function that answered", () => {
  assert.equal(stageOfTier("localCard"), "localCard");
  assert.equal(stageOfTier("grounded"), "generateAnswer");
  assert.equal(stageOfTier("synthesis"), "synthesizeAnswer");
  assert.equal(stageOfTier("silent"), "silence");
});

test("index counts leave out excluded paths and tell two sources' files apart", () => {
  const chunks = [
    chunk("a1", "README.md", { sourceId: "s1" }),
    chunk("a2", "README.md", { sourceId: "s1" }),
    chunk("b1", "README.md", { sourceId: "s2" }),
    chunk("c1", "dist/bundle.js", { sourceId: "s1" }),
  ];
  assert.deepEqual(indexCounts(chunks), { filesIndexed: 3, chunksIndexed: 4 });
  assert.deepEqual(indexCounts(chunks, ["dist/*.js"]), { filesIndexed: 2, chunksIndexed: 3 });
});

test("a record lists at most ten hits and keeps the last twenty searches", () => {
  const ranked: Hit[] = Array.from({ length: 14 }, (_, i) => ({ ...chunk(`h${i}`, `src/f${i}.ts`), score: 20 - i }));
  const input = { query: "q", chunks: ranked, ranked, sent: ranked.slice(0, 6), stage: "silence" as const, reason: "why not" };

  const record = buildSearchDebug(input);
  assert.equal(record.topHits.length, SEARCH_DEBUG_TOP);
  assert.deepEqual(record.topHits.map((hit) => hit.sentToAnswer), [true, true, true, true, true, true, false, false, false, false]);
  assert.equal(record.reason, "why not");
  // A stage that answered carries no silence reason.
  assert.equal(buildSearchDebug({ ...input, stage: "generateAnswer" }).reason, null);

  process.env.DEBUG_SEARCH = "true";
  printed(() => {
    for (let i = 0; i < 25; i += 1) reportSearchDebug({ ...input, query: `q${i}` });
  });
  const log = searchDebugLog();
  assert.equal(log.length, 20);
  assert.equal(log[0].query, "q5");
  assert.equal(log[19].query, "q24");
});

// The Search details panel: the same record, top three, one line of text each.

const RETRY_TEXT = [
  "// Exports go out in batches.",
  "",
  "export async function sendBatch(batch: Batch) {",
  "  // A failed export is retried three times with a doubling delay.",
  "  return withRetry(() => post(batch), { attempts: 3 });",
  "}",
].join("\n");

function detailsInput(overrides: Partial<Parameters<typeof buildSearchDetails>[0]> = {}) {
  const ranked: Hit[] = [
    { ...chunk("r1", "src/exporter/retry.ts", { startLine: 12, text: RETRY_TEXT }), score: 21.456 },
    { ...chunk("r2", "docs/exports.md", { text: "# Exports\n\nFailed exports are retried when the sink is down." }), score: 9.1 },
    { ...chunk("r3", "src/exporter/sink.ts", { text: "export const SINK_TIMEOUT_MS = 4000;" }), score: 4 },
    { ...chunk("r4", "src/exporter/queue.ts", { text: "export class Queue {}" }), score: 2 },
    { ...chunk("r5", "src/unrelated.ts", { text: "export const x = 1;" }), score: 1 },
  ];
  return {
    query: "How does the app retry failed exports?",
    chunks: ranked,
    ranked,
    sent: ranked,
    stage: "localCard" as const,
    totalMs: 41.6,
    ...overrides,
  };
}

test("the snippet is the line of the chunk that shares the most words with the question", () => {
  assert.equal(
    snippetOf(RETRY_TEXT, "How does the app retry failed exports?"),
    "// A failed export is retried three times with a doubling delay.",
  );
  // Nothing in common: the first line with text in it, not a blank or a brace.
  assert.equal(snippetOf("\n}\n\n  const   total = 3;\n", "weather in tokyo"), "const total = 3;");
  assert.equal(snippetOf("", "anything"), "");
});

test("a long line is cut to one hundred and sixty characters with an ellipsis", () => {
  const snippet = snippetOf(`retry ${"x".repeat(400)}`, "retry");
  assert.equal(snippet.length, 160);
  assert.ok(snippet.endsWith("…"));
});

test("search details hold the index size, the top three hits with a snippet, and the stage", () => {
  const details = buildSearchDetails(detailsInput());

  assert.equal(details.filesIndexed, 5);
  assert.equal(details.chunksIndexed, 5);
  assert.equal(details.topHits.length, SEARCH_DETAILS_TOP);
  assert.deepEqual(
    details.topHits.map((hit) => [hit.rank, hit.path, hit.line, hit.score]),
    [
      [1, "src/exporter/retry.ts", 12, 21.46],
      [2, "docs/exports.md", 1, 9.1],
      [3, "src/exporter/sink.ts", 1, 4],
    ],
  );
  assert.deepEqual(
    details.topHits.map((hit) => hit.snippet),
    [
      "// A failed export is retried three times with a doubling delay.",
      "Failed exports are retried when the sink is down.",
      "export const SINK_TIMEOUT_MS = 4000;",
    ],
  );
  assert.equal(details.stage, "localCard");
  assert.equal(details.silence, null);
  assert.equal(details.reason, null);
  assert.equal(details.totalMs, 41.6);
});

test("silent search details carry the silence kind and the reason, an answer carries neither", () => {
  const silent = buildSearchDetails(
    detailsInput({ stage: "silence", silence: "not-stated", reason: "Found the file, but it does not say." }),
  );
  assert.equal(silent.stage, "silence");
  assert.equal(silent.silence, "not-stated");
  assert.equal(silent.reason, "Found the file, but it does not say.");

  // A kind left over on a card that a stage answered is not reported as silence.
  const answered = buildSearchDetails(detailsInput({ stage: "generateAnswer", silence: "weak-match", reason: "stale" }));
  assert.equal(answered.silence, null);
  assert.equal(answered.reason, null);

  // No material: an empty index and no hits, still a record.
  const empty = buildSearchDetails({ query: "q", chunks: [], ranked: [], sent: [], stage: "silence", silence: "index" });
  assert.deepEqual([empty.filesIndexed, empty.chunksIndexed, empty.topHits.length], [0, 0, 0]);
  assert.equal(empty.silence, "index");
});

test("the stage is shown in the four words the panel uses", () => {
  assert.equal(stageLabel("generateAnswer"), "generate");
  assert.equal(stageLabel("synthesizeAnswer"), "synthesize");
  assert.equal(stageLabel("localCard"), "localCard");
  assert.equal(stageLabel("silence"), "silence");
});

test("file text stays out of the console record, and details are never logged or kept", () => {
  process.env.DEBUG_SEARCH = "true";
  const input = detailsInput({ stage: "silence", silence: "unverified", reason: "Could not verify it." });

  const lines = printed(() => {
    buildSearchDetails(input);
  });
  assert.deepEqual(lines, [], "building the panel record prints nothing");
  assert.deepEqual(searchDebugLog(), [], "and keeps nothing in the global log");

  const text = printed(() => reportSearchDebug(input)).join("\n");
  const [record] = searchDebugLog();
  assert.equal(record.silence, "unverified");
  assert.match(text, /answered by: silence .*\(unverified: Could not verify it\.\)/);
  for (const hit of record.topHits) assert.equal("snippet" in hit, false);
  assert.doesNotMatch(text, /doubling delay|SINK_TIMEOUT_MS/);
  assert.doesNotMatch(JSON.stringify(record), /doubling delay|SINK_TIMEOUT_MS/);
});

const sumOf = (parts: { lexical: number; semantic: number; structural: number; symbol: number }) =>
  parts.lexical + parts.semantic + parts.structural + parts.symbol;

test("the four score parts add up to the score, on words only and with every channel", async () => {
  const chunks = buildChunks(NORTHSTAR);
  const questions = [QUESTION, "What does withRetry do?", "Where is flow.ts used?", "What does rotateCookie do?"];

  // Words only: what a search does while the space has no vectors.
  for (const question of questions) {
    const hits = await hybridRetrieve(question, chunks, createMemoryVectorStore(), 6, undefined, { semantic: false });
    assert.ok(hits.length > 0, question);
    for (const hit of hits) {
      const parts = scoreParts(hit);
      assert.ok(Math.abs(sumOf(parts) - hit.score) < 1e-9, `${question} ${hit.path}: ${JSON.stringify(parts)} vs ${hit.score}`);
      assert.equal(parts.semantic, 0);
    }
  }
  // A question that writes a symbol out has its declaration scored as symbol.
  const named = await hybridRetrieve("What does withRetry do?", chunks, createMemoryVectorStore(), 6, undefined, { semantic: false });
  assert.equal(named[0]!.path, "src/exporter/retry.ts");
  assert.ok(scoreParts(named[0]!).symbol > 0, JSON.stringify(scoreParts(named[0]!)));
  // One that names a file has it scored as structural.
  const file = await hybridRetrieve("Where is flow.ts used?", chunks, createMemoryVectorStore(), 6, undefined, { semantic: false });
  assert.ok(file.some((hit) => hit.path === "src/auth/flow.ts" && scoreParts(hit).structural > 0));

  // Every channel: vectors for each chunk.
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const store = createMemoryVectorStore();
  await store.set(chunks.map((c) => ({ chunkId: c.id, embedding: bagEmbedding384(c.text), contentHash: c.id })));
  let semantic = 0;
  for (const question of questions) {
    for (const hit of await hybridRetrieve(question, chunks, store, 6)) {
      const parts = scoreParts(hit);
      assert.ok(Math.abs(sumOf(parts) - hit.score) < 1e-9, `${question} ${hit.path}: ${JSON.stringify(parts)} vs ${hit.score}`);
      assert.ok(Math.abs(parts.semantic - RETRIEVAL_WEIGHTS.semantic * (hit.semanticScore ?? 0)) < 1e-9);
      if (parts.semantic > 0) semantic += 1;
    }
  }
  assert.ok(semantic > 0, "no hit scored in the semantic channel");

  // The plain lexical ranking has no channels: the score is lexical plus symbol.
  for (const hit of retrieve(QUESTION, chunks)) {
    const parts = scoreParts(hit);
    assert.ok(Math.abs(sumOf(parts) - hit.score) < 1e-9);
    assert.equal(parts.semantic + parts.structural, 0);
  }
});

test("what a chunk gets for a symbol the question names is shown as symbol, not as lexical or structural", () => {
  const declares: Hit = {
    ...chunk("a", "src/exporter/retry.ts"),
    score: 1.0 * 40 + 0.6 * 16,
    lexicalScore: 40,
    semanticScore: 0,
    structuralScore: 16,
    boosts: { body: 6, symbolLift: 18, symbolDefinition: 12, declares: 4 },
    structuralBoosts: { fileName: 4, symbolDefinition: 12 },
  };
  const parts = scoreParts(declares);
  assert.deepEqual(parts, { lexical: 6, semantic: 0, structural: 0.6 * 4, symbol: 34 + 0.6 * 12 });
  assert.ok(Math.abs(sumOf(parts) - declares.score) < 1e-9);

  const meaning: Hit = { ...chunk("b", "docs/a.md"), score: 0.8 * 0.5, lexicalScore: 0, semanticScore: 0.5, structuralScore: 0 };
  assert.deepEqual(scoreParts(meaning), { lexical: 0, semantic: 0.4, structural: 0, symbol: 0 });
});

test("search details carry the breakdown for each of the top hits, rounded like the score", () => {
  const details = buildSearchDetails(detailsInput());
  for (const hit of details.topHits) {
    assert.deepEqual(Object.keys(hit.parts), ["lexical", "semantic", "structural", "symbol"]);
    assert.ok(Math.abs(sumOf(hit.parts) - hit.score) <= 0.02, `${hit.path}: ${JSON.stringify(hit.parts)} vs ${hit.score}`);
  }
  // The console record is unchanged: it lists the addends, not the parts.
  assert.ok(buildSearchDebug(detailsInput()).topHits.every((hit) => !("parts" in hit)));
});
