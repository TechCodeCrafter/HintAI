import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import "fake-indexeddb/auto";

import { EMBED_WAIT_MS, indexContext } from "../../context/chunk-index.ts";
import { createMemoryRepository } from "../../context/memory.ts";
import { persistPackAsContext } from "../../context/service.ts";
import { createIndexedDbVectorStore } from "../../context/storage/vector-store-indexeddb.ts";
import type { IndexedChunk, RepoPack } from "../../repo/types.ts";
import { bagEmbedding384, setEmbedderForTests } from "../embedding.ts";
import { EMBED_BATCH, embedIndexedChunks, embedInBackground, embeddingIdle } from "../embed-chunks.ts";
import { declaredNames } from "../declared-names.ts";
import { declaredSymbols, symbolParts } from "../query-symbols.ts";
import { buildChunks, declaredIdentifiers, retrieve, tokenize, warmSearchIndex } from "../retrieve.ts";
import { vectorCacheKey } from "../retrieval-scope.ts";
import { createMemoryVectorStore, type VectorStore } from "../vector-store.ts";
import { bagOf, freq, isEditDistanceOne, stemOf, termOf } from "../word-index.ts";

// ── The compact word index gives the same counts as one map per chunk ───────

/** The matching the index replaced: a map of words and "~stem" entries, scanned for typos. */
function referenceTally(words: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const word of words) {
    map.set(word, (map.get(word) ?? 0) + 1);
    const stem = stemOf(word);
    if (stem !== word) map.set(`~${stem}`, (map.get(`~${stem}`) ?? 0) + 1);
  }
  return map;
}

function referenceFreq(words: Map<string, number>, term: string): number {
  const direct = (words.get(term) ?? 0) + 0.5 * (words.get(`~${stemOf(term)}`) ?? 0);
  if (direct > 0) return direct;
  if (term.length < 5) return 0;
  let best = 0;
  for (const [word, count] of words) {
    if (word.startsWith("~") || word.length < 5) continue;
    if (Math.abs(word.length - term.length) > 1) continue;
    if (!isEditDistanceOne(word, term)) continue;
    if (count > best) best = count;
  }
  return 0.6 * best;
}

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("word index: counts, stems and typos match a map of words, for every word asked", () => {
  const random = rng(11);
  const roots = ["retry", "export", "session", "cookie", "invoice", "queue", "parse", "token", "config", "experience", "billing", "retrieval"];
  const endings = ["", "s", "ed", "ing", "ment", "ation", "al", "ly", "es", "er", "x"];
  const vocabulary = roots.flatMap((root) => endings.map((ending) => root + ending)).concat(["a", "is", "id", "ts", "abcde", "abcdf", "abde"]);
  const pick = () => vocabulary[Math.floor(random() * vocabulary.length)];
  // Asked words: ones in the vocabulary, ones a typo away, and ones that are nowhere.
  const asked = [...vocabulary, "experince", "retrys", "sesion", "cokie", "invoicee", "zebra", "abcd", "abcdx", "confg"];
  let compared = 0;
  for (let round = 0; round < 200; round += 1) {
    const words = Array.from({ length: Math.floor(random() * 60) }, pick);
    const reference = referenceTally(words);
    const bag = bagOf(words);
    for (const word of asked) {
      assert.equal(freq(bag, termOf(word)), referenceFreq(reference, word), `"${word}" in round ${round}`);
      compared += 1;
    }
  }
  assert.ok(compared > 20_000);
});

test("word index: a word first seen after a question was asked is still found", () => {
  // The question is resolved before any text holds the word, as on the first
  // search of freshly loaded material.
  const early = termOf("quokkaburrow");
  assert.equal(freq(bagOf(["something", "else"]), early), 0);
  const later = bagOf(["quokkaburrow", "quokkaburrows", "quokkaburow"]);
  assert.equal(freq(later, termOf("quokkaburrow")), referenceFreq(referenceTally(["quokkaburrow", "quokkaburrows", "quokkaburow"]), "quokkaburrow"));
  assert.equal(freq(bagOf(["quokkaburow"]), termOf("quokkaburrow")), 0.6, "one typo away, found after the fact");
});

// ── The exact-phrase bonus is given to exactly the chunks that hold the phrase ──

const PHRASES: RepoPack = {
  id: "phrases",
  name: "phrases",
  description: "",
  commits: [],
  files: [
    { path: "src/a.ts", language: "ts", content: "// retry backoff doubles\nexport const a = 1;\n" },
    { path: "src/b.ts", language: "ts", content: "// the xretry backoffs are mid-word\nexport const b = 1;\n" },
    { path: "src/c.ts", language: "ts", content: "// RETRY BACKOFF in capitals, and tsconfig\nexport const c = 1;\n" },
    { path: "src/d.ts", language: "ts", content: "// retryBackoff as one identifier, dead-letter queue\nexport const d = 1;\n" },
    { path: "src/e.ts", language: "ts", content: "// the \u212Aelvin scale is not ASCII: retry backoff \u212A\nexport const e = 1;\n" },
    { path: "src/f.ts", language: "ts", content: "// nothing relevant here at all\nexport const f = 1;\n" },
    { path: "src/g.ts", language: "ts", content: "// see retry.ts for the config.yaml loader\nexport const g = 1;\n" },
    // The Kelvin sign lower-cases to "k", which joins two words into one that
    // the word splitter never saw.
    { path: "src/h.ts", language: "ts", content: "// alpha foo\u212AbarBaz omega\nexport const h = 1;\n" },
  ],
};

test("exact phrase: the bonus goes to every chunk whose text holds the phrase, and to no other", () => {
  const chunks = buildChunks(PHRASES);
  const questions = [
    "retry backoff",
    "backoff",
    "config",
    "tsconfig",
    "kelvin scale",
    "dead-letter queue",
    "retry.ts",
    "retry backoff doubles",
    "xretry backoffs",
    "letter queue",
    "scale",
    "relevant here",
    "the config.yaml loader",
    "queue",
    "elvin",
    "alpha fookbarbaz omega",
  ];
  let withPhrase = 0;
  for (const question of questions) {
    const hits = retrieve(question, chunks, 20);
    // The phrase is the question's search words in order, as the ranking joins them.
    const phrase = tokenize(question).join(" ");
    if (phrase.length <= 4) continue;
    for (const chunk of chunks) {
      const holds = chunk.text.toLowerCase().includes(phrase);
      const hit = hits.find((item) => item.id === chunk.id);
      if (holds) {
        withPhrase += 1;
        assert.ok(hit, `"${question}" finds ${chunk.path}`);
        assert.ok((hit?.boosts?.exactPhrase ?? 0) > 0, `"${question}" credits ${chunk.path}`);
      } else {
        assert.equal(hit?.boosts?.exactPhrase, undefined, `"${question}" does not credit ${chunk.path}`);
      }
    }
  }
  assert.ok(withPhrase >= 20, `only ${withPhrase} phrase matches were exercised`);
});

// ── Finding the declaration of a named identifier skips chunks, never answers ──

const HERE = new URL("..", import.meta.url);

const DECLARATIONS: RepoPack = {
  id: "decl",
  name: "decl",
  description: "",
  commits: [],
  files: [
    // Some of this folder's own source: real declarations in the styles the code uses.
    ...["query-symbols.ts", "word-index.ts", "declared-names.ts", "embed-chunks.ts"].map((name) => ({
      path: `src/lib/search/${name}`,
      language: "ts",
      content: readFileSync(new URL(name, HERE), "utf8"),
    })),
    {
      path: "lib/shapes.py",
      language: "py",
      content: [
        "def verify_claim(say, evidence):",
        "    return True",
        "",
        "class HTMLParser:",
        "    def __init__(self):",
        "        self.verifyClaim = lambda say: say",
        "",
        "MAX_PER_FILE = 3",
        "def smokeGate91626(): pass",
        "def smoke_gate_91626(): pass",
        "def Verify_Claim(): pass",
        "def VERIFYCLAIM(): pass",
        "def verifyclaim(): pass",
        "def verIfyclaim(): pass",
        "def xverifyClaim(): pass",
        "def verifyClaims(): pass",
        "def tokenCache__reset(): pass",
        "",
      ].join("\n"),
    },
    {
      path: "lib/odd.ts",
      language: "ts",
      content: "// caf\u00e9\nexport function re\u017FetQueue() {}\nexport function resetQueue() {}\nfunction ma\u212AeToken() {}\n",
    },
    // A camelCase hump beside the underscore cuts the indexed word short:
    // "gate_91626" here, "smoke_gate" in the next file.
    { path: "lib/hump_before.py", language: "py", content: "def smokeGate_91626(): pass\n" },
    { path: "lib/hump_after.py", language: "py", content: "def smoke_gateCheck(): pass\n" },
    // An accented letter stays a separator when lower-cased, so the index is
    // trusted for this file. The dotted capital I becomes "i" plus a mark.
    { path: "lib/accent.py", language: "py", content: "# caf\u00e9 \u2014 \u00b7\ndef claimcheck\u00e9(): pass\n" },
    { path: "lib/dotted.py", language: "py", content: "def claimcheck\u0130(): pass\n" },
    { path: "lib/accent_only.py", language: "py", content: "# caf\u00e9 \u2014 claimcheck is only mentioned here\n" },
    {
      path: "lib/kelvin.py",
      language: "py",
      // The pattern sees "claimcheck" end at the Kelvin sign. Lower-cased, the
      // sign is a "k", so the word the index holds is "claimcheckk".
      content: "def claimcheck\u212A(): pass\n",
    },
    { path: "docs/notes.md", language: "md", content: "```ts\nfunction verifyClaim() {}\n```\n" },
  ],
};

test("named identifier: the word index skips chunks but finds exactly the declarations the pattern finds", () => {
  const chunks = buildChunks(DECLARATIONS);
  const names = new Set<string>(["verifyClaim", "verify_claim", "HTMLParser", "MAX_PER_FILE", "smokeGate91626", "resetQueue", "makeToken", "notDeclaredAnywhere", "verifyClaims", "xverifyClaim", "verIfyclaim", "claimcheck", "smokeGateCheck", "smoke_gate_check", "tokenCacheReset"]);
  for (const chunk of chunks) {
    for (const name of declaredNames(chunk.text)) {
      names.add(name);
      // The same identifier written the other way round.
      const parts = symbolParts(name);
      if (parts.length > 1) {
        names.add(parts.join("_"));
        names.add(parts.map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1))).join(""));
      }
    }
  }
  const idsOf = (found: ReturnType<typeof declaredSymbols>) =>
    found.map((symbol) => [symbol.key, [...symbol.chunks].map((chunk) => chunk.id).sort()] as const);
  let asked = 0;
  let declared = 0;
  for (const name of names) {
    for (const question of [`What does \`${name}\` do?`, `Where is ${name}() called?`]) {
      // A fresh list each time: the last answer per list is remembered.
      const byPattern = declaredSymbols(question, [...chunks]);
      const byIndex = declaredIdentifiers(question, [...chunks]);
      assert.deepEqual(idsOf(byIndex), idsOf(byPattern), question);
      asked += 1;
      declared += byPattern.length;
    }
  }
  assert.ok(asked > 100, `only ${asked} questions`);
  assert.ok(declared > 80, `only ${declared} found a declaration`);
  assert.equal(declaredIdentifiers("What does `claimcheck` do?", [...chunks])[0]?.chunks.size, 3);
});

// ── The word index is built ahead of the first question, in slices ──────────

function manyChunks(count: number): IndexedChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `w${i}`,
    kind: "code" as const,
    path: `src/mod${i % 40}/file${i}.ts`,
    startLine: 1,
    endLine: 3,
    startOffset: 0,
    text: `export function handler${i}() {\n  // settlement export retries with backoff number ${i}\n}\n`,
  }));
}

test("warm-up indexes every chunk, pauses between slices, and gives the same ranking", async () => {
  const cold = manyChunks(400);
  const warm = manyChunks(400);
  let pauses = 0;
  const done = await warmSearchIndex(warm, {
    sliceMs: 0,
    pause: async () => {
      pauses += 1;
    },
  });
  assert.equal(done, 400);
  assert.equal(pauses, 400, "with a zero-length slice it pauses after every chunk");
  const question = "settlement export retries backoff";
  assert.deepEqual(
    retrieve(question, warm).map((hit) => [hit.id, hit.score]),
    retrieve(question, cold).map((hit) => [hit.id, hit.score]),
  );
});

test("warm-up stops when cancelled or when a newer warm-up starts", async () => {
  const chunks = manyChunks(300);
  let stop = false;
  let pauses = 0;
  const done = await warmSearchIndex(chunks, {
    sliceMs: 0,
    isCancelled: () => stop,
    pause: async () => {
      pauses += 1;
      if (pauses === 10) stop = true;
    },
  });
  assert.equal(done, 10);

  let second: Promise<number> | null = null;
  const first = await warmSearchIndex(manyChunks(300), {
    sliceMs: 0,
    pause: async () => {
      second ??= warmSearchIndex(manyChunks(5), { sliceMs: 1000 });
    },
  });
  assert.equal(first, 1, "the first run ends once another has started");
  assert.equal(await second, 5);
});

// ── Vectors: read once, kept in memory, shared with a second open of the database ──

test("IndexedDB vectors are served from memory after the first read, and persist", async () => {
  const name = `meethint-vectors-test-${crypto.randomUUID()}`;
  const tab = createIndexedDbVectorStore(name);
  await tab.set([
    { chunkId: "a", embedding: [0.5, 0.25, 0.125], contentHash: "h1" },
    { chunkId: "b", embedding: [1, 0, 0], contentHash: "h2" },
  ]);
  const first = (await tab.get(["a", "b", "nope"])).get("a");
  const again = (await tab.get(["a"])).get("a");
  assert.ok(first instanceof Float32Array, "kept as stored, not copied into a plain array");
  assert.equal(first, again, "the same array, not a second read");
  assert.deepEqual(Array.from(first ?? []), [0.5, 0.25, 0.125]);

  // A second open of the same database, as after a reload, reads what was written.
  const reloaded = createIndexedDbVectorStore(name);
  assert.deepEqual(Array.from((await reloaded.get(["a"])).get("a") ?? []), [0.5, 0.25, 0.125]);
  assert.deepEqual([...((await reloaded.hashes?.(["a", "b", "nope"])) ?? [])].sort(), [
    ["a", "h1"],
    ["b", "h2"],
  ]);

  // Another tab writes a vector this one had found missing. An index pass
  // (`hashes`) looks again; a plain read in between does not.
  assert.equal((await tab.get(["c"])).size, 0);
  await reloaded.set([{ chunkId: "c", embedding: [1, 1], contentHash: "h3" }]);
  assert.equal((await tab.get(["c"])).size, 0, "not looked up again on every search");
  assert.equal((await tab.hashes?.(["c"]))?.get("c"), "h3");
  assert.deepEqual(Array.from((await tab.get(["c"])).get("c") ?? []), [1, 1]);

  await tab.delete(["a"]);
  assert.equal(await tab.has("a"), false);
  assert.equal((await tab.get(["a"])).size, 0);
  assert.equal((await createIndexedDbVectorStore(name).get(["a"])).size, 0, "deleted in the database too");
});

test("a large space's vectors are read in batches, and a search that arrives meanwhile reads nothing twice", async () => {
  const name = `meethint-vectors-test-${crypto.randomUUID()}`;
  const ids = Array.from({ length: 4500 }, (_, i) => `row-${i}`);
  await createIndexedDbVectorStore(name).set(ids.map((chunkId, i) => ({ chunkId, embedding: [i, 1], contentHash: "h" })));

  // After a reload: the read-ahead starts, and a question is asked before it ends.
  const tab = createIndexedDbVectorStore(name);
  const ahead = tab.get([...ids, "never-written"]);
  const search = tab.get(ids.slice(4000));
  const [all, some] = await Promise.all([ahead, search]);
  assert.equal(all.size, 4500);
  assert.equal(some.size, 500);
  assert.equal(some.get("row-4499"), all.get("row-4499"), "the search was handed the rows the read-ahead brought in");
  assert.deepEqual(Array.from(all.get("row-4321") ?? []), [4321, 1]);
});

// ── Embedding: one read to find what is missing, small batches, each one kept ──

function counted(inner: VectorStore) {
  const calls = { hashes: 0, has: 0, isStale: 0, set: 0, setSizes: [] as number[] };
  const store: VectorStore = {
    set: async (entries) => {
      calls.set += 1;
      calls.setSizes.push(entries.length);
      return inner.set(entries);
    },
    get: (ids) => inner.get(ids),
    delete: (ids) => inner.delete(ids),
    has: async (id) => {
      calls.has += 1;
      return inner.has(id);
    },
    isStale: async (id, hash) => {
      calls.isStale += 1;
      return inner.isStale(id, hash);
    },
    entries: (ids) => inner.entries(ids),
    hashes: async (ids) => {
      calls.hashes += 1;
      return inner.hashes!(ids);
    },
  };
  return { store, calls };
}

test("embedding asks the store once what it has, and writes in small batches", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  try {
    const chunks = manyChunks(EMBED_BATCH * 3 + 5);
    const { store, calls } = counted(createMemoryVectorStore());
    const first = await embedIndexedChunks(chunks, store);
    assert.deepEqual(first, { wrote: chunks.length, reused: 0 });
    assert.equal(calls.hashes, 1);
    assert.equal(calls.has + calls.isStale, 0, "no lookup per chunk");
    assert.deepEqual(calls.setSizes, [EMBED_BATCH, EMBED_BATCH, EMBED_BATCH, 5]);

    const second = await embedIndexedChunks(chunks, store);
    assert.deepEqual(second, { wrote: 0, reused: chunks.length });
    assert.equal(calls.set, 4, "nothing written the second time");
  } finally {
    setEmbedderForTests(null);
  }
});

test("an interrupted embedding pass keeps what it wrote, and the next pass does the rest", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  try {
    const chunks = manyChunks(EMBED_BATCH * 4);
    const store = createMemoryVectorStore();
    let batches = 0;
    const first = await embedIndexedChunks(chunks, store, {
      pause: async () => {
        batches += 1;
      },
      isCancelled: () => batches >= 2,
    });
    assert.deepEqual(first, { wrote: EMBED_BATCH * 2, reused: 0 });
    assert.equal((await store.get(chunks.map((chunk) => vectorCacheKey(chunk)))).size, EMBED_BATCH * 2);

    const second = await embedIndexedChunks(chunks, store);
    assert.deepEqual(second, { wrote: EMBED_BATCH * 2, reused: EMBED_BATCH * 2 });
  } finally {
    setEmbedderForTests(null);
  }
});

test("a model that fails leaves search working and nothing half-written", async () => {
  setEmbedderForTests(async () => {
    throw new Error("model not available");
  });
  try {
    const chunks = manyChunks(20);
    const store = createMemoryVectorStore();
    assert.deepEqual(await embedIndexedChunks(chunks, store), { wrote: 0, reused: 0 });
    assert.ok(retrieve("settlement export retries", chunks).length > 0);
  } finally {
    setEmbedderForTests(null);
  }
});

// ── An index pass does not wait for a slow model ────────────────────────────

const SLOW: RepoPack = {
  id: "slow",
  name: "slow",
  description: "",
  commits: [],
  files: Array.from({ length: 12 }, (_, i) => ({
    path: `src/part${i}.ts`,
    language: "ts",
    content: `// Part ${i}: settlement exports retry with exponential backoff.\nexport const part${i} = ${i};\n`,
  })),
};

test("an index pass returns without waiting for a slow model, and the vectors arrive later", async () => {
  let encoded = 0;
  setEmbedderForTests(async (text) => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    encoded += 1;
    return bagEmbedding384(text);
  });
  try {
    const repo = createMemoryRepository();
    const { context } = await persistPackAsContext(SLOW, repo);
    const store = createMemoryVectorStore();
    const started = performance.now();
    const runtime = await indexContext(repo, context.id, { embed: true, vectorStore: store, embedWaitMs: 0 });
    const waited = performance.now() - started;
    const keys = runtime.chunks.map((chunk) => vectorCacheKey(chunk));
    assert.ok(runtime.chunks.length >= 12);
    assert.equal(encoded, 0, `returned after ${Math.round(waited)} ms with the model still working`);
    assert.equal((await store.get(keys)).size, 0);
    // Search does not need the vectors.
    assert.ok(retrieve("settlement exports backoff", runtime.chunks).length > 0);

    await embeddingIdle(store);
    assert.equal((await store.get(keys)).size, runtime.chunks.length, "every chunk has a vector once the queue is empty");
    assert.equal(encoded, runtime.chunks.length);
  } finally {
    setEmbedderForTests(null);
  }
});

test("a fast model is finished when the index pass returns, as before", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  try {
    assert.ok(EMBED_WAIT_MS >= 1000);
    const repo = createMemoryRepository();
    const { context } = await persistPackAsContext(SLOW, repo);
    const store = createMemoryVectorStore();
    const runtime = await indexContext(repo, context.id, { embed: true, vectorStore: store });
    const keys = runtime.chunks.map((chunk) => vectorCacheKey(chunk));
    assert.equal((await store.get(keys)).size, runtime.chunks.length);
  } finally {
    setEmbedderForTests(null);
  }
});

test("a cancelled pass stops encoding", async () => {
  let encoded = 0;
  setEmbedderForTests(async (text) => {
    encoded += 1;
    return bagEmbedding384(text);
  });
  try {
    const store = createMemoryVectorStore();
    let cancelled = false;
    const chunks = manyChunks(EMBED_BATCH * 5);
    const job = embedInBackground(chunks, store, {
      isCancelled: () => cancelled,
      pause: async () => {
        cancelled = true;
      },
    });
    await job;
    assert.equal(encoded, EMBED_BATCH, "one batch, then it noticed");
  } finally {
    setEmbedderForTests(null);
  }
});
