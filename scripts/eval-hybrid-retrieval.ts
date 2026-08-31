/**
 * Phase 5 hybrid retrieval eval.
 *
 * Compares lexical retrieve() to hybridRetrieve() on Northstar + a self pack.
 * Uses the 384-d bag embedder so the script always runs without downloading
 * MiniLM. Real-model numbers need a separately loaded checkpoint.
 *
 * node --experimental-strip-types scripts/eval-hybrid-retrieval.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { USE_HYBRID_RETRIEVAL } from "../src/lib/context/index-versions.ts";
import { NORTHSTAR } from "../src/lib/repo/northstar.ts";
import type { Card, Hit, IndexedChunk, RepoPack } from "../src/lib/repo/types.ts";
import { bagEmbedding384, setEmbedderForTests } from "../src/lib/search/embedding.ts";
import { embedIndexedChunks } from "../src/lib/search/embed-chunks.ts";
import { verifyClaim } from "../src/lib/search/evidence.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { buildChunks, hybridRetrieve, retrieve } from "../src/lib/search/retrieve.ts";
import { createMemoryVectorStore } from "../src/lib/search/vector-store.ts";

type Probe = {
  q: string;
  gold: string[];
  answerable: boolean;
};

const NORTHSTAR_PROBES: Probe[] = [
  { q: "Why does that retry three times?", gold: ["src/exporter/retry.ts", "docs/adr/0007-exporter-retries.md"], answerable: true },
  { q: "What does the settlement exporter do?", gold: ["src/exporter/index.ts", "README.md"], answerable: true },
  { q: "How does edge auth work?", gold: ["src/auth/flow.ts", "src/auth/middleware.ts"], answerable: true },
  { q: "Where is the retry policy?", gold: ["src/exporter/retry.ts"], answerable: true },
  { q: "Why is the column order locked?", gold: ["src/exporter/format.ts"], answerable: true },
  { q: "Who touched the auth flow?", gold: ["src/auth/flow.ts"], answerable: true },
  { q: "What is the architecture of this application?", gold: ["README.md"], answerable: true },
  { q: "What is the weather in Tokyo?", gold: [], answerable: false },
  { q: "Do we have unit tests?", gold: [], answerable: false },
  { q: "What happens if the export fails halfway through?", gold: [], answerable: false },
];

const SELF_PROBES: Probe[] = [
  { q: "How does retrieval score the chunks?", gold: ["src/lib/search/retrieve.ts"], answerable: true },
  { q: "How does the question gate work?", gold: ["src/lib/search/question.ts"], answerable: true },
  { q: "How does caption cleaning work?", gold: ["src/lib/document/chunk.ts"], answerable: true },
  { q: "What is the weather in Tokyo?", gold: [], answerable: false },
];

const SKIP = /node_modules|\.git\b|dist|\.output|screenshots|\.vite|package-lock|\.eval|\.grok/;

function selfPack(): RepoPack {
  const files: RepoPack["files"] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = `${dir}/${entry}`;
      if (SKIP.test(p)) continue;
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs|md)$/.test(p) && s.size < 200_000) {
        files.push({
          path: p.replace(/^\.\//, ""),
          language: "ts",
          content: readFileSync(p, "utf8").slice(0, 80_000),
        });
      }
    }
  };
  walk("src");
  return {
    id: "meethint-self",
    name: "meethint-self",
    description: "MeetHint source",
    files: files.slice(0, 220),
    commits: [],
  };
}

type Run = {
  top1: number;
  top3: number;
  top6: number;
  labeled: number;
  wrongIntent: number;
  unsupported: number;
  falseSilence: number;
  spoken: number;
  silent: number;
  semanticWon: number;
  latencies: number[];
  embedMs: number;
};

function hitAt(hits: Hit[], gold: string[], k: number): boolean {
  if (gold.length === 0) return false;
  return hits.slice(0, k).some((h) => gold.some((g) => h.path === g || h.path.endsWith(`/${g}`)));
}

function citedPaths(card: Card): string[] {
  return card.citations.flatMap((c) => (c.kind === "file" ? [c.path] : []));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function evaluate(
  pack: RepoPack,
  probes: Probe[],
  hybrid: boolean,
): Promise<Run> {
  const chunks: IndexedChunk[] = buildChunks(pack);
  const store = createMemoryVectorStore();
  const embedStarted = performance.now();
  if (hybrid) {
    setEmbedderForTests(async (text) => bagEmbedding384(text));
    await embedIndexedChunks(chunks, store);
  }
  const embedMs = performance.now() - embedStarted;
  const run: Run = {
    top1: 0,
    top3: 0,
    top6: 0,
    labeled: 0,
    wrongIntent: 0,
    unsupported: 0,
    falseSilence: 0,
    spoken: 0,
    silent: 0,
    semanticWon: 0,
    latencies: [],
    embedMs,
  };

  for (const probe of probes) {
    const t0 = performance.now();
    const hits = hybrid ? await hybridRetrieve(probe.q, chunks, store, 6) : retrieve(probe.q, chunks, 6);
    run.latencies.push(performance.now() - t0);
    const card = localCard(probe.q, hits, pack, 0, null);
    if (probe.gold.length > 0) {
      run.labeled += 1;
      if (hitAt(hits, probe.gold, 1)) run.top1 += 1;
      if (hitAt(hits, probe.gold, 3)) run.top3 += 1;
      if (hitAt(hits, probe.gold, 6)) run.top6 += 1;
    }
    const winner = hits[0];
    if (winner && (winner.semanticScore ?? 0) > (winner.lexicalScore ?? 0)) run.semanticWon += 1;
    if (card.say) {
      run.spoken += 1;
      const support = verifyClaim(card.say, card.evidence ?? []);
      if (!support.ok) run.unsupported += 1;
      if (probe.gold.length > 0) {
        const cites = citedPaths(card);
        const onGold = cites.length === 0 || cites.some((p) => probe.gold.includes(p));
        if (!onGold) run.wrongIntent += 1;
      } else if (!probe.answerable) {
        run.wrongIntent += 1;
      }
    } else {
      run.silent += 1;
      if (probe.answerable) run.falseSilence += 1;
    }
  }
  return run;
}

function rate(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}% (${n}/${d})`;
}

function report(label: string, run: Run) {
  return {
    label,
    top1: rate(run.top1, run.labeled),
    top3: rate(run.top3, run.labeled),
    top6: rate(run.top6, run.labeled),
    wrongIntent: rate(run.wrongIntent, run.spoken + run.silent),
    unsupported: rate(run.unsupported, run.spoken + run.silent),
    falseSilence: rate(run.falseSilence, run.spoken + run.silent),
    semanticWon: run.semanticWon,
    spoken: run.spoken,
    silent: run.silent,
    latencyMs: {
      p50: Number(percentile(run.latencies, 50).toFixed(2)),
      p95: Number(percentile(run.latencies, 95).toFixed(2)),
    },
    embedMs: Number(run.embedMs.toFixed(2)),
  };
}

function acceptable(base: Run, next: Run): boolean {
  if (next.wrongIntent !== 0) return false;
  if (next.unsupported !== 0) return false;
  const hitBetter = next.top6 > base.top6 || next.top3 > base.top3 || next.top1 > base.top1;
  const silenceBetter = next.falseSilence < base.falseSilence;
  return hitBetter || silenceBetter;
}

setEmbedderForTests(async (text) => bagEmbedding384(text));

const self = selfPack();
const suites = [
  { name: "northstar", pack: NORTHSTAR, probes: NORTHSTAR_PROBES },
  { name: "self", pack: self, probes: SELF_PROBES },
];

const rows = [];
for (const suite of suites) {
  const baseline = await evaluate(suite.pack, suite.probes, false);
  const hybrid = await evaluate(suite.pack, suite.probes, true);
  rows.push({
    suite: suite.name,
    files: suite.pack.files.length,
    baseline: report("lexical", baseline),
    hybrid: report("hybrid", hybrid),
    flip: acceptable(baseline, hybrid),
  });
}

const shouldFlip = rows.every((row) => row.flip) && USE_HYBRID_RETRIEVAL === false;

console.log(
  JSON.stringify(
    {
      flag: USE_HYBRID_RETRIEVAL,
      embedder: "bag-384-fallback",
      shouldFlip,
      reason: shouldFlip
        ? "Hybrid matches the flip bar on every suite."
        : "Keep USE_HYBRID_RETRIEVAL = false. Hybrid is not equal-or-better on the flip bar yet (or this run used the bag fallback, not MiniLM).",
      suites: rows,
    },
    null,
    2,
  ),
);

setEmbedderForTests(null);
