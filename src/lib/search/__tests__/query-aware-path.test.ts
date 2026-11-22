import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { Hit, RepoPack } from "../../repo/types.ts";
import { setEmbedderForTests } from "../embedding.ts";
import { retrieveStructural } from "../hybrid.ts";
import { declaredSymbols, symbolCandidates } from "../query-symbols.ts";
import { buildChunks, hybridRetrieve, namedCode, retrieve } from "../retrieve.ts";
import { RETRIEVAL_WEIGHTS } from "../retrieval-weights.ts";
import { buildSearchDebug, clearSearchDebugLog, reportSearchDebug } from "../search-debug.ts";
import { createMemoryVectorStore } from "../vector-store.ts";

/**
 * A question that names a symbol or a file is about that place. These tests
 * pin that the place outranks the README and the docs, which mention the
 * symbol far more often than the line that declares it.
 */

function file(path: string, lines: string[]) {
  return { path, language: path.split(".").pop() ?? "txt", content: lines.join("\n") };
}

const PACK: RepoPack = {
  id: "fixture",
  name: "claims-service",
  description: "",
  commits: [],
  files: [
    // The README is written to win on text: the symbol and the word "work" on
    // nearly every line, and a fenced copy of the declaration.
    file("README.md", [
      "# Claims service",
      "",
      "How verifyClaim works: verifyClaim checks a spoken line. verifyClaim works on words.",
      "The work verifyClaim does is described here, and verifyClaim work is covered in the docs.",
      "When verifyClaim does not work, the answer stays silent. That is how verifyClaim works.",
      "",
      "```ts",
      "export function verifyClaim(say: string, evidence: string[]): boolean {",
      "```",
    ]),
    file("docs/architecture.md", [
      "# Architecture",
      "",
      "The composer calls verifyClaim before it speaks. How verifyClaim works is the core of the product.",
      "verifyClaim work is done per sentence, and verifyClaim works without a model.",
    ]),
    file("src/search/evidence.ts", [
      'import { wordsOf } from "./words";',
      "",
      "/** True when every content word of the line is in the cited lines. */",
      "export function verifyClaim(say: string, evidence: string[]): boolean {",
      "  return wordsOf(say).every((word) => evidence.some((line) => line.includes(word)));",
      "}",
    ]),
    file("src/search/compose.ts", [
      'import { verifyClaim } from "./evidence";',
      "",
      "export function compose(say: string, evidence: string[]) {",
      "  // verifyClaim has to pass before the line is spoken.",
      "  return verifyClaim(say, evidence) ? say : null;",
      "}",
    ]),
    file("src/bench/timings.ts", [
      "export function report(timings: Record<string, number>) {",
      "  const verifyClaim = timings.verifyClaim;",
      "  return `verifyClaim took ${verifyClaim} ms`;",
      "}",
    ]),
    file("src/api/router.ts", [
      "/** Routes a question to the composer, which runs verifyClaim. */",
      "export const routes = [];",
    ]),
    file("src/tools/score.py", [
      "def score_claim(say, evidence):",
      '    """Counts the words of the line that the evidence holds."""',
      "    return sum(1 for word in say.split() if word in evidence)",
    ]),
    file("src/components/answer-card.tsx", [
      "/** Shows the spoken line with its citations. */",
      "export function AnswerCard(props: { say: string }) {",
      "  return <p>{props.say}</p>;",
      "}",
    ]),
    file("src/config/limits.ts", ["/** Most chunks one file may place in the results. */", "export const MAX_PER_FILE = 2;"]),
    // Unrelated files, so the words of the question are rare in the material
    // and a chunk that repeats them scores the way it does in a real repo.
    ...Array.from({ length: 40 }, (_, i) =>
      file(`src/reports/table-${i}.ts`, [`/** Column layout ${i} for the monthly report. */`, `export const columns${i} = ${i};`]),
    ),
  ],
};

const CHUNKS = buildChunks(PACK);
const QUESTION = "how does verifyClaim work";

function ranked(query: string): Hit[] {
  return retrieve(query, CHUNKS, CHUNKS.length);
}

function best(hits: Hit[], path: string): Hit | undefined {
  return hits.find((hit) => hit.path === path);
}

function rankOf(hits: Hit[], path: string): number {
  const at = hits.findIndex((hit) => hit.path === path);
  return at < 0 ? Number.POSITIVE_INFINITY : at;
}

function textOf(hit: Hit | undefined): number {
  return (hit?.boosts?.body ?? 0) + (hit?.boosts?.commit ?? 0);
}

function sum(boosts: Record<string, number> | undefined): number {
  return Object.values(boosts ?? {}).reduce((total, value) => total + value, 0);
}

afterEach(() => {
  setEmbedderForTests(null);
  delete process.env.DEBUG_SEARCH;
  clearSearchDebugLog();
});

test('"how does verifyClaim work" ranks the verifyClaim implementation above the README', () => {
  const hits = ranked(QUESTION);
  assert.equal(hits[0]?.path, "src/search/evidence.ts", hits.map((hit) => hit.path).join(", "));
  assert.ok(rankOf(hits, "src/search/evidence.ts") < rankOf(hits, "README.md"));
  assert.ok(rankOf(hits, "src/search/evidence.ts") < rankOf(hits, "docs/architecture.md"));

  // The fixture is the hard case: on text alone the README and the doc both
  // beat the file that declares the symbol.
  const implementation = best(hits, "src/search/evidence.ts");
  assert.ok(textOf(best(hits, "README.md")) > textOf(implementation));
  assert.ok(textOf(best(hits, "docs/architecture.md")) > textOf(implementation));
  assert.equal(implementation?.boosts?.symbolDefinition, RETRIEVAL_WEIGHTS.symbolDefinition);
});

test("a declaration outranks every chunk that only mentions the symbol", () => {
  // The README answers this one word for word. Its text beats the declaring
  // chunk's by more than the flat bonus, so only the lift keeps the order.
  const wordy = "how does verifyClaim work when the answer stays silent";
  const hits = ranked(wordy);
  const gap = textOf(best(hits, "README.md")) - textOf(best(hits, "src/search/evidence.ts"));
  assert.ok(gap > RETRIEVAL_WEIGHTS.symbolDefinition, `text gap ${gap}`);
  assert.ok((best(hits, "src/search/evidence.ts")?.boosts?.symbolLift ?? 0) > 0);

  for (const query of [QUESTION, wordy, "what does verifyClaim check before the composer speaks a line", "where is MAX_PER_FILE set"]) {
    const hits = ranked(query);
    const declaring = hits.filter((hit) => hit.boosts?.symbolDefinition != null);
    const others = hits.filter((hit) => hit.boosts?.symbolDefinition == null);
    assert.ok(declaring.length > 0, query);
    const lowest = Math.min(...declaring.map((hit) => hit.score));
    for (const other of others) {
      assert.ok(other.score < lowest, `${query}: ${other.path} ${other.score} vs declaration ${lowest}`);
    }
  }
});

test("the README, docs and entry-point boosts are off for a question that names a symbol, and on otherwise", () => {
  for (const query of [QUESTION, "Which router calls verifyClaim?"]) {
    for (const hit of ranked(query)) {
      assert.equal(hit.boosts?.authoritativePath, undefined, `${query}: ${hit.path}`);
      assert.equal(hit.boosts?.entryPoint, undefined, `${query}: ${hit.path}`);
    }
  }
  // The same material, asked about in ordinary words.
  const plain = ranked("How does the composer check a spoken line?");
  assert.ok((best(plain, "docs/architecture.md")?.boosts?.authoritativePath ?? 0) > 0);
  const api = ranked("Which router sends a question to the composer?");
  assert.ok((best(api, "src/api/router.ts")?.boosts?.entryPoint ?? 0) > 0);
});

test("a word that is only written like an identifier changes nothing", () => {
  // Nothing in the pack declares TypeScript or GitHub.
  const asked = "How does TypeScript make the composer work on GitHub?";
  assert.deepEqual(namedCode(asked, CHUNKS), { symbols: [], paths: [] });
  assert.deepEqual(
    ranked(asked).map((hit) => [hit.id, hit.score]),
    ranked(asked.toLowerCase()).map((hit) => [hit.id, hit.score]),
  );
  assert.ok((best(ranked(asked), "docs/architecture.md")?.boosts?.authoritativePath ?? 0) > 0);
  // Written like a file name, and no file is called that.
  assert.deepEqual(namedCode("What does the composer do, e.g. for a spoken line?", CHUNKS).paths, []);
});

test("a question that names a loaded file is ranked on the path, without the docs bonus", () => {
  const asked = "What does evidence.ts do?";
  assert.deepEqual(namedCode(asked, CHUNKS).paths, ["evidence.ts"]);
  const hits = ranked(asked);
  assert.equal(hits[0]?.path, "src/search/evidence.ts");
  assert.equal(hits[0]?.boosts?.namedPath, RETRIEVAL_WEIGHTS.pathMatch);
  for (const hit of hits) assert.equal(hit.boosts?.authoritativePath, undefined, hit.path);
});

test("an identifier is recognised as a call, in backticks, and across naming conventions", () => {
  for (const query of ["what does verifyClaim() return", "explain `verifyClaim`", "how does verify_claim work"]) {
    assert.equal(ranked(query)[0]?.path, "src/search/evidence.ts", query);
  }
  // Asked in camel case, declared in Python as score_claim.
  assert.equal(ranked("how does scoreClaim count words")[0]?.path, "src/tools/score.py");
  assert.deepEqual(symbolCandidates("how does the composer work").map((symbol) => symbol.name), []);
});

test("a local variable and a declaration quoted in a document are not declarations", () => {
  const [symbol] = declaredSymbols(QUESTION, CHUNKS);
  assert.ok(symbol);
  assert.deepEqual([...symbol.chunks].map((chunk) => chunk.path), ["src/search/evidence.ts"]);
  const hits = ranked(QUESTION);
  assert.equal(best(hits, "src/bench/timings.ts")?.boosts?.symbolDefinition, undefined);
  assert.equal(best(hits, "README.md")?.boosts?.symbolDefinition, undefined);
});

test("a file named after the symbol is credited for it", () => {
  const hits = ranked("What does AnswerCard show?");
  const card = hits[0];
  assert.equal(card?.path, "src/components/answer-card.tsx");
  assert.ok((card?.boosts?.symbolFile ?? 0) > 0, "answer-card.tsx is the file of AnswerCard");
  assert.equal(card?.boosts?.symbolDefinition, RETRIEVAL_WEIGHTS.symbolDefinition);
});

test("the recorded boosts are the whole score", () => {
  for (const query of [QUESTION, "What does evidence.ts do?", "How does the composer check a spoken line?", "What does AnswerCard show?"]) {
    const hits = ranked(query);
    assert.ok(hits.length > 0, query);
    for (const hit of hits) {
      assert.ok(Math.abs(sum(hit.boosts) - hit.score) < 1e-9, `${query}: ${hit.path} ${sum(hit.boosts)} vs ${hit.score}`);
    }
  }
});

test("the symbol bonus stays above the kind-of-file bonuses a mention can collect", () => {
  const w = RETRIEVAL_WEIGHTS;
  assert.ok(w.symbolDefinition > w.exactPhrase + w.behaviorPath + w.fileHead + w.apiShapePath);
  assert.ok(w.symbolDefinition > w.exactPhrase + w.documentPath + w.documentDefinition);
  assert.ok(w.symbolDefinition >= w.pathMatch, "a named symbol is worth what a named file is");
});

test("the structural channel scores the declaration, and the fused ranking keeps it first", async () => {
  const structural = retrieveStructural(QUESTION, CHUNKS, CHUNKS.length);
  assert.equal(structural[0]?.path, "src/search/evidence.ts");
  assert.deepEqual(structural[0]?.structuralBoosts, { symbolDefinition: RETRIEVAL_WEIGHTS.symbolDefinition });
  assert.equal(structural[0]?.score, RETRIEVAL_WEIGHTS.symbolDefinition);

  // The worst case for the implementation: the README's embedding is the
  // question's, and the implementation's is unrelated.
  const like = [1, 0, 0, 0];
  const unlike = [0, 1, 0, 0];
  setEmbedderForTests(async () => like);
  const store = createMemoryVectorStore();
  await store.set(
    CHUNKS.map((chunk) => ({
      chunkId: chunk.id,
      embedding: chunk.path === "README.md" || chunk.path === "docs/architecture.md" ? like : unlike,
      contentHash: chunk.id,
    })),
  );
  const hits = await hybridRetrieve(QUESTION, CHUNKS, store, 6);
  assert.equal(hits[0]?.path, "src/search/evidence.ts", hits.map((hit) => `${hit.path} ${hit.score.toFixed(1)}`).join(", "));
  const readme = best(hits, "README.md");
  assert.ok(readme && (readme.semanticScore ?? 0) > 9, "the README did get the full semantic score");
  assert.equal(hits[0]?.structuralBoosts?.symbolDefinition, RETRIEVAL_WEIGHTS.symbolDefinition);
});

/** Runs `fn` and returns what it printed with console.info. */
function printed(fn: () => void): string {
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
  return lines.join("\n");
}

test("the search debug log shows the exact boost values behind each hit", () => {
  process.env.DEBUG_SEARCH = "true";
  const hits = ranked(QUESTION);
  const input = { query: QUESTION, chunks: CHUNKS, ranked: hits, sent: hits.slice(0, 6), stage: "localCard" as const };
  const record = buildSearchDebug(input);

  assert.deepEqual(record.namedSymbols, ["verifyClaim"]);
  assert.deepEqual(record.namedPaths, []);
  const top = record.topHits[0];
  assert.equal(top.path, "src/search/evidence.ts");
  assert.equal(top.boosts?.symbolDefinition, RETRIEVAL_WEIGHTS.symbolDefinition);
  assert.equal(top.boosts?.symbolLift, Number((hits[0].boosts?.symbolLift ?? 0).toFixed(2)));
  for (const hit of record.topHits) {
    assert.ok(hit.boosts, hit.path);
    // Each value is rounded to two places, so the sum is within a cent each.
    assert.ok(Math.abs(sum(hit.boosts) - hit.score) <= 0.01 * Object.keys(hit.boosts).length, hit.path);
    assert.equal(hit.boosts.authoritativePath, undefined, hit.path);
  }

  const text = printed(() => reportSearchDebug(input));
  assert.match(text, /names code: verifyClaim\. README, docs and entry-point boosts are off for this question\./);
  assert.match(
    text,
    new RegExp(`score = body ${top.boosts!.body.toFixed(2)} \\+ symbolDefinition 12\\.00 \\+ symbolLift ${top.boosts!.symbolLift.toFixed(2)}`),
  );

  const plain = "How does the composer check a spoken line?";
  const plainHits = ranked(plain);
  const plainText = printed(() => reportSearchDebug({ ...input, query: plain, ranked: plainHits, sent: plainHits }));
  assert.match(plainText, /names no symbol or file in the material/);
  assert.match(plainText, /\+ authoritativePath \d+\.\d\d/);
});

test("on the hybrid path the log shows each channel and what the structural channel added", async () => {
  setEmbedderForTests(async () => [1, 0, 0, 0]);
  const store = createMemoryVectorStore();
  await store.set(CHUNKS.map((chunk) => ({ chunkId: chunk.id, embedding: [1, 0, 0, 0], contentHash: chunk.id })));
  const hits = await hybridRetrieve(QUESTION, CHUNKS, store, 6);
  const record = buildSearchDebug({ query: QUESTION, chunks: CHUNKS, ranked: hits, sent: hits, stage: "localCard" });
  const top = record.topHits[0];
  assert.equal(top.path, "src/search/evidence.ts");
  assert.equal(top.structural, RETRIEVAL_WEIGHTS.symbolDefinition);
  assert.deepEqual(top.structuralBoosts, { symbolDefinition: RETRIEVAL_WEIGHTS.symbolDefinition });
  // The fused score is the three channels at their weights.
  const fused =
    RETRIEVAL_WEIGHTS.lexical * top.lexical! + RETRIEVAL_WEIGHTS.semantic * top.semantic! + RETRIEVAL_WEIGHTS.structural * top.structural!;
  assert.ok(Math.abs(fused - top.score) < 0.05, `${fused} vs ${top.score}`);

  process.env.DEBUG_SEARCH = "true";
  const text = printed(() =>
    reportSearchDebug({ query: QUESTION, chunks: CHUNKS, ranked: hits, sent: hits, stage: "localCard" }),
  );
  assert.match(text, /score = 1 x lexical \d+\.\d\d \+ 0\.8 x semantic \d+\.\d\d \+ 0\.6 x structural 12\.00/);
  assert.match(text, /lexical = body \d+\.\d\d \+ symbolDefinition 12\.00/);
  assert.match(text, /structural = symbolDefinition 12\.00/);
});
