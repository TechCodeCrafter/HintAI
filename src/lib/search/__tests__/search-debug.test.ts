import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { demoAnswer } from "../../demo/answer.ts";
import { isSearchDebug } from "../../debug.ts";
import { NORTHSTAR } from "../../repo/northstar.ts";
import type { Chunk, Hit } from "../../repo/types.ts";
import { buildChunks, retrieve } from "../retrieve.ts";
import {
  buildSearchDebug,
  clearSearchDebugLog,
  indexCounts,
  reportSearchDebug,
  SEARCH_DEBUG_TOP,
  searchDebugLog,
  stageOfTier,
} from "../search-debug.ts";

const QUESTION = "Why does that retry three times?";

afterEach(() => {
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
