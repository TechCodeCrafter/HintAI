import assert from "node:assert/strict";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import type { Card, ConsideredSource, DocumentHit, FileHit, Hit, RepoPack } from "../../repo/types.ts";
import { isFileHit } from "../../repo/types.ts";
import type { NormalizedDocument } from "../../document/types.ts";
import { FAST_PATH_MIN_SCORE } from "../answer-fast-path.ts";
import { cardFromHistory, historyItemFromCard } from "../answer-history.ts";
import { routeSearchAnswer } from "../answer-route.ts";
import {
  CONSIDERED_LIMIT,
  consideredSources,
  consideredText,
  stillLoaded,
  withConsidered,
} from "../considered.ts";
import { verifyClaim } from "../evidence.ts";
import { generateAnswer } from "../generate-answer.ts";
import { localCard } from "../local-card.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

const QUESTION = "Why does that retry three times?";
const chunks = buildChunks(NORTHSTAR);
const retryHits = retrieve(QUESTION, chunks);

function fileOf(pack: RepoPack, path: string) {
  const file = pack.files.find((item) => item.path === path);
  assert.ok(file, `${path} is in the pack`);
  return file;
}

/** The lines a considered entry points at, read from the loaded file. */
function linesOf(pack: RepoPack, entry: ConsideredSource): string {
  assert.equal(entry.kind, "file");
  if (entry.kind !== "file") return "";
  return fileOf(pack, entry.path).content.split("\n").slice(entry.startLine - 1, entry.endLine).join("\n");
}

/** A code hit built from real text in a pack file. */
function hitAt(pack: RepoPack, path: string, needle: string, score = 10): FileHit {
  const content = fileOf(pack, path).content;
  const startOffset = content.indexOf(needle);
  assert.ok(startOffset >= 0, `${needle} is in ${path}`);
  const startLine = content.slice(0, startOffset).split("\n").length;
  return {
    id: `${path}:${startOffset}`,
    kind: "code",
    path,
    startLine,
    endLine: startLine + needle.split("\n").length - 1,
    startOffset,
    text: needle,
    score,
  } as FileHit;
}

const pack: RepoPack = {
  id: "considered-fixture",
  name: "considered-fixture",
  description: "fixture",
  files: [
    { path: "src/a.ts", language: "ts", content: "// a\nexport const retries = 3;\nexport const delay = 200;\n" },
    { path: "src/b.ts", language: "ts", content: "// b\n\nexport function backoff() {\n  return 2;\n}\n" },
    { path: "src/c.ts", language: "ts", content: "export const c = 1;\n" },
    { path: "src/d.ts", language: "ts", content: "export const d = 1;\n" },
    { path: "src/e.ts", language: "ts", content: "export const e = 1;\n" },
  ],
  commits: [],
};

test("considered entries are other loaded files, best first, one per file, capped", () => {
  const hits: Hit[] = [
    hitAt(pack, "src/a.ts", "export const retries = 3;"),
    hitAt(pack, "src/b.ts", "export function backoff() {\n  return 2;\n}"),
    hitAt(pack, "src/b.ts", "// b"),
    hitAt(pack, "src/c.ts", "export const c = 1;"),
    hitAt(pack, "src/d.ts", "export const d = 1;"),
    hitAt(pack, "src/e.ts", "export const e = 1;"),
  ];
  const cited = [{ kind: "file" as const, path: "src/a.ts", line: 2, label: "" }];
  const out = consideredSources(hits, cited, { pack });

  assert.equal(CONSIDERED_LIMIT, 3);
  assert.deepEqual(
    out.map((entry) => entry.path),
    ["src/b.ts", "src/c.ts", "src/d.ts"],
  );
  // The cited file is never listed as "other".
  assert.ok(!out.some((entry) => entry.path === "src/a.ts"));
  // One entry per file: the best-ranked chunk, at its real lines.
  assert.deepEqual(out[0], {
    kind: "file",
    path: "src/b.ts",
    startLine: 3,
    endLine: 5,
    sourceId: undefined,
    displayName: undefined,
  });
  assert.equal(linesOf(pack, out[0]), "export function backoff() {\n  return 2;\n}");
});

test("line ranges come from the loaded file, not from a stale chunk", () => {
  const stale = { ...hitAt(pack, "src/b.ts", "export function backoff() {\n  return 2;\n}"), startLine: 40, endLine: 44, startOffset: 9000 };
  const [entry] = consideredSources([stale], [], { pack });
  assert.ok(entry && entry.kind === "file");
  assert.equal(entry.startLine, 3);
  assert.equal(entry.endLine, 5);
});

test("nothing is listed that is not loaded as retrieved", () => {
  const real = hitAt(pack, "src/b.ts", "// b");
  const gone = { ...real, id: "gone", path: "src/removed.ts" };
  const changed = { ...real, id: "changed", text: "this text is no longer in the file" };
  const why = { ...real, id: "why", kind: "why" as const, path: "src/c.ts", text: "Cap retries at three" };
  const excluded = hitAt(pack, "src/c.ts", "export const c = 1;");

  assert.deepEqual(consideredSources([gone, changed, why], [], { pack }), []);
  assert.deepEqual(consideredSources([excluded], [], { pack: { ...pack, excludePatterns: ["src/c.ts"] } }), []);
  // With nothing loaded to check against, the list is empty, never guessed.
  assert.deepEqual(consideredSources([real], [], {}), []);
});

const handbook: NormalizedDocument = {
  sourceId: "pdf-1",
  contentHash: "hash-1",
  pages: [
    { pageNumber: 1, text: "Intro." },
    { pageNumber: 2, text: "Refunds settle within five business days." },
  ],
} as unknown as NormalizedDocument;

function pdfHit(over: Partial<DocumentHit> = {}): DocumentHit {
  const text = "Refunds settle within five business days.";
  return {
    id: "pdf-1:2:0",
    kind: "document",
    path: "handbook.pdf",
    sourceId: "pdf-1",
    contentHash: "hash-1",
    page: 2,
    startOffset: 0,
    endOffset: text.length,
    heading: "Refunds",
    text,
    score: 9,
    ...over,
  } as DocumentHit;
}

test("a PDF is listed by page only when the loaded document still holds that text", () => {
  const document = (sourceId: string) => (sourceId === "pdf-1" ? handbook : undefined);
  const listed = consideredSources([pdfHit()], [], { pack, document });
  assert.deepEqual(listed, [
    { kind: "document", path: "handbook.pdf", sourceId: "pdf-1", page: 2, heading: "Refunds", displayName: undefined },
  ]);
  assert.equal(consideredText(listed[0]), 'handbook.pdf · Page 2 · "Refunds"');

  assert.deepEqual(consideredSources([pdfHit({ contentHash: "older" })], [], { pack, document }), []);
  assert.deepEqual(consideredSources([pdfHit({ page: 7 })], [], { pack, document }), []);
  assert.deepEqual(consideredSources([pdfHit({ sourceId: "pdf-9" })], [], { pack, document }), []);
  // No hydrated document and no source record: nothing proves it is loaded.
  assert.deepEqual(consideredSources([pdfHit()], [], { pack }), []);
  // A cited document is not an "other" file.
  const cite = { kind: "document" as const, sourceId: "pdf-1", path: "handbook.pdf", page: 2, label: "" };
  assert.deepEqual(consideredSources([pdfHit()], [cite], { pack, document }), []);
});

test("consideredText prints the same coordinates a citation chip does", () => {
  assert.equal(consideredText({ kind: "file", path: "src/b.ts", startLine: 3, endLine: 5 }), "src/b.ts:3-5");
  assert.equal(consideredText({ kind: "file", path: "src/b.ts", startLine: 3, endLine: 3 }), "src/b.ts:3");
  assert.equal(
    consideredText({ kind: "file", path: "src/b.ts", startLine: 3, endLine: 5, displayName: "billing" }),
    "billing · src/b.ts:3-5",
  );
});

test("withConsidered sets the list and removes a stale one", () => {
  const base: Card = { query: "q", say: null, reason: "r", citations: [], latencyMs: 0 } as unknown as Card;
  const withList = withConsidered(base, [hitAt(pack, "src/b.ts", "// b")], { pack });
  assert.equal(withList.considered?.length, 1);
  const cleared = withConsidered(withList, [], { pack });
  assert.equal("considered" in cleared, false);
  assert.equal(withConsidered(base, [], { pack }), base);
});

test("stillLoaded drops entries whose file is gone", () => {
  const entries: ConsideredSource[] = [
    { kind: "file", path: "src/b.ts", startLine: 1, endLine: 1 },
    { kind: "file", path: "src/removed.ts", startLine: 1, endLine: 1 },
    { kind: "document", path: "handbook.pdf", sourceId: "pdf-1", page: 2 },
    { kind: "document", path: "old.pdf", sourceId: "pdf-9", page: 1 },
  ];
  const kept = stillLoaded(entries, { paths: new Set(["src/b.ts"]), sourceIds: new Set(["pdf-1"]) });
  assert.deepEqual(
    kept.map((entry) => entry.path),
    ["src/b.ts", "handbook.pdf"],
  );
  assert.deepEqual(stillLoaded(undefined, { paths: new Set(), sourceIds: new Set() }), []);
});

/** Every considered entry is a real range of a loaded file the Card does not cite. */
function assertStrict(card: Card, loaded: RepoPack) {
  const cited = new Set(card.citations.flatMap((cite) => (cite.kind === "file" ? [cite.path] : [])));
  const entries = card.considered ?? [];
  assert.ok(entries.length <= CONSIDERED_LIMIT);
  assert.equal(new Set(entries.map((entry) => entry.path)).size, entries.length);
  for (const entry of entries) {
    assert.equal(entry.kind, "file");
    if (entry.kind !== "file") continue;
    const file = fileOf(loaded, entry.path);
    const total = file.content.split("\n").length;
    assert.ok(entry.startLine >= 1 && entry.endLine >= entry.startLine && entry.endLine <= total, consideredText(entry));
    assert.ok(!cited.has(entry.path), `${entry.path} is cited, so it is not "other"`);
  }
}

test("a composer answer and a model answer both carry cited lines and considered files", async () => {
  const composed = localCard(QUESTION, retryHits, NORTHSTAR, 0);
  assert.ok(composed.say);
  const composedCite = composed.citations.find((cite) => cite.kind === "file");
  assert.ok(composedCite && composedCite.kind === "file" && composedCite.line >= 1);
  assert.ok((composed.considered?.length ?? 0) >= 1, "the composer lists other files");
  assertStrict(composed, NORTHSTAR);

  const fileHits = retryHits.filter(isFileHit);
  const body = fileHits.findIndex((hit) => /Attempts are capped at three/.test(hit.text));
  assert.ok(body >= 0);
  const llmOnly = fileHits.map((hit, index) => (index === 0 ? { ...hit, score: FAST_PATH_MIN_SCORE - 1 } : hit));
  const routed = await routeSearchAnswer(QUESTION, llmOnly, 0, {
    pack: NORTHSTAR,
    ask: async () => ({
      text: `Attempts are capped at three because a fourth attempt duplicates the settlement file. [${body + 1}]`,
    }),
  });
  assert.equal(routed.tier, "grounded");
  const modelCite = routed.card.citations.find((cite) => cite.kind === "file");
  assert.ok(modelCite && modelCite.kind === "file");
  const cited = fileOf(NORTHSTAR, modelCite.path).content.split("\n");
  assert.ok(modelCite.line >= 1 && (modelCite.endLine ?? modelCite.line) <= cited.length);
  assert.ok((routed.card.considered?.length ?? 0) >= 1, "the model answer lists other files");
  assertStrict(routed.card, NORTHSTAR);
});

test("a silent card names the files that were checked", async () => {
  const hits = retrieve("Do we store card numbers in the export?", chunks);
  const routed = await routeSearchAnswer("Do we store card numbers in the export?", hits, 0, {
    pack: NORTHSTAR,
    ask: async () => ({ text: "INSUFFICIENT" }),
  });
  assert.equal(routed.card.say, null);
  assert.deepEqual(routed.card.citations, []);
  assert.ok((routed.card.considered?.length ?? 0) >= 1);
  assertStrict(routed.card, NORTHSTAR);
});

test("a model answer that cites a commit gets a commit citation, not invented file lines", async () => {
  const why = retryHits.filter(isFileHit).find((hit) => hit.kind === "why");
  assert.ok(why, "the retry question ranks a commit message");
  const message = why.message ?? why.text;
  const sentence = message.split("\n")[0].replace(/[.\s]+$/, "");
  const result = await generateAnswer(QUESTION, [why], 0, {
    pack: NORTHSTAR,
    ask: async () => ({ text: `${sentence}. [1]` }),
  });
  assert.ok(result.ok, "the commit message verifies the sentence");
  if (!result.ok) return;
  assert.equal(result.answer.citations.length, 1);
  const [cite] = result.answer.citations;
  assert.equal(cite.kind, "commit");
  assert.ok(cite.kind === "commit" && NORTHSTAR.commits.some((commit) => commit.sha === cite.sha));
  assert.ok(!result.answer.citations.some((item) => item.kind === "file"));
});

test("a model answer cites the lines that carry the sentence, not the whole chunk it was shown", async () => {
  const fileHits = retryHits.filter(isFileHit);
  const code = fileHits.find((hit) => hit.kind === "code" && /Attempts are capped at three/.test(hit.text));
  assert.ok(code);
  assert.ok(code.endLine - code.startLine > 10, "the chunk shown to the model is much longer than the sentence");
  const say = "Attempts are capped at three because a fourth attempt duplicates the settlement file.";
  const result = await generateAnswer(QUESTION, [code], 0, {
    pack: NORTHSTAR,
    ask: async () => ({ text: `${say} [1]` }),
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  const [cite] = result.answer.citations;
  assert.ok(cite && cite.kind === "file");
  // Lines 4 and 5 hold every word of the sentence. Line 6 ("recovering it.") adds nothing to it.
  assert.equal(`${cite.path}:${cite.line}-${cite.endLine}`, "src/exporter/retry.ts:4-5");

  // The narrowed evidence is the loaded file's own text at those lines, and the sentence still verifies on it.
  const [evidence] = result.answer.evidence ?? [];
  assert.ok(evidence && evidence.kind === "text");
  const content = fileOf(NORTHSTAR, cite.path).content;
  assert.equal(evidence.text, content.split("\n").slice(3, 5).join("\n"));
  // One line fewer on either side and the sentence no longer verifies.
  const lines = content.split("\n");
  const span = (from: number, to: number) => ({ ...evidence, text: lines.slice(from, to).join("\n"), normalizedText: lines.slice(from, to).join("\n") });
  assert.equal(verifyClaim(say, [span(4, 5)]).ok, false);
  assert.equal(verifyClaim(say, [span(3, 4)]).ok, false);
  assert.equal(content.slice(evidence.startOffset, evidence.endOffset), evidence.text);
  assert.equal(cite.evidenceId, evidence.id);
  assert.equal(verifyClaim(say, [evidence]).ok, true);
});

test("a chunk the sentence does not need keeps its range, and a sentence that fails stays unspoken", async () => {
  const fileHits = retryHits.filter(isFileHit);
  const code = fileHits.find((hit) => hit.kind === "code" && /Attempts are capped at three/.test(hit.text));
  const other = fileHits.find((hit) => hit.kind === "code" && hit.path !== code?.path);
  assert.ok(code && other);
  const say = "Attempts are capped at three because a fourth attempt duplicates the settlement file.";

  const both = await generateAnswer(QUESTION, [code, other], 0, {
    pack: NORTHSTAR,
    ask: async () => ({ text: `${say} [1][2]` }),
  });
  assert.ok(both.ok);
  if (!both.ok) return;
  const cites = both.answer.citations.filter((cite) => cite.kind === "file");
  assert.equal(cites.length, 2);
  const needed = cites.find((cite) => cite.path === code.path);
  const context = cites.find((cite) => cite.path === other.path);
  assert.equal(`${needed?.line}-${needed?.endLine}`, "4-5");
  // Cited by the model as context: left exactly as the chunk, not cut to an arbitrary line.
  assert.equal(context?.line, other.startLine);
  assert.equal(context?.endLine ?? context?.line, other.endLine);

  const wrong = await generateAnswer(QUESTION, [code], 0, {
    pack: NORTHSTAR,
    ask: async () => ({ text: "Attempts are capped at seven because of Kafka rebalancing. [1]" }),
  });
  assert.equal(wrong.ok, false);
});

test("a model answer cannot cite a commit or a file that is not loaded", async () => {
  const fileHits = retryHits.filter(isFileHit);
  const why = fileHits.find((hit) => hit.kind === "why");
  const code = fileHits.find((hit) => hit.kind === "code" && /Attempts are capped at three/.test(hit.text));
  assert.ok(why && code);
  const claim = "Attempts are capped at three because a fourth attempt duplicates the settlement file. [1]";

  const unknownCommit = await generateAnswer(QUESTION, [{ ...why, sha: "0000000", id: "0000000" }], 0, {
    pack: NORTHSTAR,
    ask: async () => ({ text: `${(why.message ?? why.text).split("\n")[0]} [1]` }),
  });
  assert.equal(unknownCommit.ok, false);

  const without: RepoPack = { ...NORTHSTAR, files: NORTHSTAR.files.filter((file) => file.path !== code.path) };
  const removedFile = await generateAnswer(QUESTION, [code], 0, { pack: without, ask: async () => ({ text: claim }) });
  assert.equal(removedFile.ok, false);

  const loaded = await generateAnswer(QUESTION, [code], 0, { pack: NORTHSTAR, ask: async () => ({ text: claim }) });
  assert.equal(loaded.ok, true);
});

test("history keeps the considered list with the answer", () => {
  const card = localCard(QUESTION, retryHits, NORTHSTAR, 0);
  assert.ok(card.considered?.length);
  const restored = cardFromHistory(historyItemFromCard(card));
  assert.deepEqual(restored.considered, card.considered);

  const { considered: _none, ...bare } = card;
  assert.equal("considered" in cardFromHistory(historyItemFromCard(bare as Card)), false);
});
