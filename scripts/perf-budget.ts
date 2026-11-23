/**
 * Measures search time and memory against the performance budget on a
 * synthetic index, so the numbers can be re-run rather than taken on trust.
 *
 *   node --expose-gc --experimental-strip-types scripts/perf-budget.ts [chunks]
 *
 * What it measures, over N code chunks held in memory, in Node on this machine:
 *   - `retrieve()`, the lexical ranking every search runs;
 *   - `hybridRetrieve()`, the ranking the app uses once chunks have vectors:
 *     lexical + structural + cosine similarity over one 384-wide vector per
 *     chunk, with the vectors held in memory;
 *   - building the word index ahead of the first question.
 *
 * What it does not measure: a browser tab, IndexedDB, the MiniLM model (the
 * vectors here are a deterministic stand-in of the same width, so encoding
 * the question and the chunks costs nothing here and does in the app), or the
 * answer stages after ranking. Heap figures are V8's in Node, not a browser's.
 *
 * Exits 1 when a budget is missed, so it can gate a change.
 */
import { bagEmbedding384, setEmbedderForTests } from "../src/lib/search/embedding.ts";
import { hybridRetrieve, retrieve, warmSearchIndex } from "../src/lib/search/retrieve.ts";
import { vectorCacheKey } from "../src/lib/search/retrieval-scope.ts";
import type { VectorStore } from "../src/lib/search/vector-store.ts";
import type { IndexedChunk } from "../src/lib/repo/types.ts";

const CHUNKS = Number(process.argv[2] ?? 50_000);
const SEARCH_BUDGET_MS = 400;
const MEMORY_BUDGET_MB = 400;
const CHUNKS_PER_FILE = 20;
const LINES_PER_CHUNK = 30;

/** Deterministic, so two runs build the same corpus. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const SYLLABLES = "ac ad al an ar ba bi bo ca ce co da de di do el en er fa fi fo ga ge go ha he hi in is ka ke la le li lo ma me mi mo na ne no or pa pe po ra re ri ro sa se si so ta te ti to ur va ve vi vo wa we za ze".split(" ");
const COMMON = "const let return if else for while function class import export from async await new this value result error data item index key name type list map set get id".split(" ");
/** Words real questions use, planted at realistic rates so queries hit something. */
const TOPICS = ["retry", "backoff", "session", "cookie", "invoice", "export", "queue", "timeout", "cache", "token", "upload", "parser", "schema", "billing", "refund", "webhook"];

function vocabulary(size: number, random: () => number): string[] {
  const words = new Set<string>();
  while (words.size < size) {
    const parts = 2 + Math.floor(random() * 3);
    let word = "";
    for (let i = 0; i < parts; i += 1) word += SYLLABLES[Math.floor(random() * SYLLABLES.length)];
    words.add(word);
  }
  return [...words];
}

function corpus(count: number): IndexedChunk[] {
  const random = rng(42);
  const vocab = vocabulary(20_000, random);
  // Zipf-like: a few words are everywhere, most are rare. Like code.
  const pick = () => vocab[Math.floor(vocab.length * random() ** 3)];
  const chunks: IndexedChunk[] = [];
  const files = Math.ceil(count / CHUNKS_PER_FILE);
  for (let file = 0; file < files && chunks.length < count; file += 1) {
    const path = `src/${pick()}/${pick()}/${pick()}-${file}.ts`;
    let offset = 0;
    for (let part = 0; part < CHUNKS_PER_FILE && chunks.length < count; part += 1) {
      const lines: string[] = [];
      for (let line = 0; line < LINES_PER_CHUNK; line += 1) {
        const roll = random();
        if (line === 0) {
          lines.push(`export function ${pick()}${pick().replace(/^./, (c) => c.toUpperCase())}(${pick()}: ${pick()}) {`);
        } else if (roll < 0.02) {
          const topic = TOPICS[Math.floor(random() * TOPICS.length)];
          lines.push(`  // ${topic} ${pick()} ${TOPICS[Math.floor(random() * TOPICS.length)]} ${pick()}`);
        } else {
          const words = 4 + Math.floor(random() * 6);
          const out: string[] = [];
          for (let w = 0; w < words; w += 1) out.push(random() < 0.35 ? COMMON[Math.floor(random() * COMMON.length)] : pick());
          lines.push(`  ${out.join(" ")};`);
        }
      }
      const text = lines.join("\n");
      chunks.push({
        id: `c${chunks.length}`,
        kind: "code",
        path,
        startLine: part * LINES_PER_CHUNK + 1,
        endLine: (part + 1) * LINES_PER_CHUNK,
        startOffset: offset,
        text,
      });
      offset += text.length + 1;
    }
  }
  return chunks;
}

const QUERIES = [
  "How does the retry backoff work?",
  "Where is the session cookie set?",
  "What happens when an invoice export times out?",
  "How is the upload queue drained?",
  "What does the webhook parser do with a refund?",
  "Why is the cache token refreshed?",
  "billing schema timeout",
  "How does export retry handle a queue timeout and backoff after a refund webhook?",
];

const gc = (globalThis as { gc?: () => void }).gc;
const heapMb = () => {
  gc?.();
  return process.memoryUsage().heapUsed / 1024 / 1024;
};
// Typed arrays (the vectors, the word index) keep their bytes outside the
// JavaScript heap, so a heap figure alone would not count them.
const buffersMb = () => process.memoryUsage().arrayBuffers / 1024 / 1024;
const rssMb = () => process.memoryUsage().rss / 1024 / 1024;
const fmt = (n: number) => n.toFixed(1);
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];

const base = heapMb();
const t0 = performance.now();
const chunks = corpus(CHUNKS);
const buildMs = performance.now() - t0;
const textMb = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) / 1024 / 1024;
const afterCorpus = heapMb();

// The word index is built ahead of the first question, in slices.
const warm0 = performance.now();
let slices = 0;
let longestSlice = 0;
let sliceStart = performance.now();
await warmSearchIndex(chunks, {
  pause: async () => {
    longestSlice = Math.max(longestSlice, performance.now() - sliceStart);
    slices += 1;
    await new Promise<void>((resolve) => setImmediate(resolve));
    sliceStart = performance.now();
  },
});
const warmMs = performance.now() - warm0;
const afterIndex = heapMb();

const first0 = performance.now();
const first = retrieve(QUERIES[0], chunks);
const firstMs = performance.now() - first0;

function timeAll(run: (query: string) => unknown | Promise<unknown>) {
  return (async () => {
    const out: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      for (const query of QUERIES) {
        const start = performance.now();
        await run(query);
        out.push(performance.now() - start);
      }
    }
    return out;
  })();
}
const line = (times: number[]) =>
  `p50 ${fmt(percentile(times, 0.5))} ms · p95 ${fmt(percentile(times, 0.95))} ms · worst ${fmt(Math.max(...times))} ms over ${times.length} searches`;

const lexical = await timeAll((query) => retrieve(query, chunks));

// One vector per chunk, in memory, as the app holds them once they are loaded.
setEmbedderForTests(async (text) => bagEmbedding384(text));
const vectors = new Map<string, Float32Array>();
for (const chunk of chunks) vectors.set(vectorCacheKey(chunk), Float32Array.from(bagEmbedding384(chunk.text.slice(0, 400))));
const store: VectorStore = {
  set: async () => undefined,
  get: async (ids) => {
    const out = new Map<string, ArrayLike<number>>();
    for (const id of ids) {
      const hit = vectors.get(id);
      if (hit) out.set(id, hit);
    }
    return out;
  },
  delete: async () => undefined,
  has: async (id) => vectors.has(id),
  isStale: async () => false,
  entries: async () => new Map(),
};
const hybrid = await timeAll((query) => hybridRetrieve(query, chunks, store, 6));

// Questions that name an identifier take a different path: the declaration
// of that name is looked for in the code.
const nameOf = (chunk: IndexedChunk) => /function (\w+)/.exec(chunk.text)?.[1] ?? "handler";
const NAMED = [0.1, 0.35, 0.6, 0.85].flatMap((at) => {
  const name = nameOf(chunks[Math.floor(chunks.length * at)]);
  return [`What does ${name} do?`, `Where is ${name} called from?`];
});
const named: number[] = [];
for (let round = 0; round < 3; round += 1) {
  for (const query of NAMED) {
    const start = performance.now();
    await hybridRetrieve(query, chunks, store, 6);
    named.push(performance.now() - start);
  }
}
const heapTotal = heapMb();
const buffers = buffersMb();
const held = heapTotal + buffers;

const p95 = Math.max(percentile(lexical, 0.95), percentile(hybrid, 0.95), percentile(named, 0.95));

console.log(`chunks            ${chunks.length} in ${new Set(chunks.map((c) => c.path)).size} files, ${fmt(textMb)} MB of text (built in ${fmt(buildMs)} ms)`);
console.log(`word index        built in ${fmt(warmMs)} ms ahead of the first question, in ${slices} slices, longest ${fmt(longestSlice)} ms`);
console.log(`first search      ${fmt(firstMs)} ms · ${first.length} hits`);
console.log(`lexical search    ${line(lexical)}`);
console.log(`hybrid search     ${line(hybrid)}`);
console.log(`named identifier  ${line(named)}`);
console.log(`memory held       ${fmt(held)} MB = heap ${fmt(heapTotal)} MB (text ${fmt(afterCorpus - base)}, word index objects ${fmt(afterIndex - afterCorpus)}) + typed arrays ${fmt(buffers)} MB (vectors, word counts)${gc ? "" : " (run with --expose-gc for a settled figure)"}`);
console.log(`process rss       ${fmt(rssMb())} MB (includes the Node runtime and garbage not yet returned to the system)`);
console.log(`budget            search < ${SEARCH_BUDGET_MS} ms: ${p95 < SEARCH_BUDGET_MS && firstMs < SEARCH_BUDGET_MS ? "met" : "MISSED"} (first search and p95 of each kind) · memory < ${MEMORY_BUDGET_MB} MB: ${held < MEMORY_BUDGET_MB ? "met" : "MISSED"} (heap + typed arrays)`);

if (p95 >= SEARCH_BUDGET_MS || firstMs >= SEARCH_BUDGET_MS || held >= MEMORY_BUDGET_MB) process.exit(1);
