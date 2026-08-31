/**
 * Phase 4 structured-chunker eval.
 *
 * Runs the in-repo Northstar questions and a short self-pack twice:
 * window baseline (flag default) vs structured. Does not flip the flag.
 *
 * node --experimental-strip-types scripts/eval-structured-retrieval.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { USE_STRUCTURED_CHUNKER } from "../src/lib/context/index-versions.ts";
import { NORTHSTAR } from "../src/lib/repo/northstar.ts";
import type { Card, Hit, RepoPack } from "../src/lib/repo/types.ts";
import { verifyClaim } from "../src/lib/search/evidence.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { buildChunks, retrieve } from "../src/lib/search/retrieve.ts";

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
  chunks: number;
  structuredChunks: number;
};

function hitAt(hits: Hit[], gold: string[], k: number): boolean {
  if (gold.length === 0) return false;
  return hits.slice(0, k).some((h) => gold.some((g) => h.path === g || h.path.endsWith(`/${g}`)));
}

function citedPaths(card: Card): string[] {
  return card.citations.flatMap((c) => (c.kind === "file" ? [c.path] : c.kind === "commit" ? [] : []));
}

function evaluate(pack: RepoPack, probes: Probe[], structured: boolean): Run {
  const chunks = buildChunks(pack, { structured });
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
    chunks: chunks.length,
    structuredChunks: chunks.filter((c) => Boolean(c.symbol)).length,
  };

  for (const probe of probes) {
    const hits = retrieve(probe.q, chunks, 6);
    const card = localCard(probe.q, hits, pack, 0, null);
    if (probe.gold.length > 0) {
      run.labeled += 1;
      if (hitAt(hits, probe.gold, 1)) run.top1 += 1;
      if (hitAt(hits, probe.gold, 3)) run.top3 += 1;
      if (hitAt(hits, probe.gold, 6)) run.top6 += 1;
    }
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
    chunks: run.chunks,
    structuredChunks: run.structuredChunks,
    top1: rate(run.top1, run.labeled),
    top3: rate(run.top3, run.labeled),
    top6: rate(run.top6, run.labeled),
    wrongIntent: rate(run.wrongIntent, run.spoken + run.silent),
    unsupported: rate(run.unsupported, run.spoken + run.silent),
    falseSilence: rate(run.falseSilence, run.spoken + run.silent),
    spoken: run.spoken,
    silent: run.silent,
  };
}

function acceptable(base: Run, next: Run): boolean {
  if (next.wrongIntent !== 0) return false;
  if (next.unsupported !== 0) return false;
  const hitBetter = next.top6 > base.top6 || next.top3 > base.top3 || next.top1 > base.top1;
  const silenceBetter = next.falseSilence < base.falseSilence;
  return hitBetter || silenceBetter;
}

const self = selfPack();
const suites = [
  { name: "northstar", pack: NORTHSTAR, probes: NORTHSTAR_PROBES },
  { name: "self", pack: self, probes: SELF_PROBES },
];

const rows = suites.map((suite) => {
  const baseline = evaluate(suite.pack, suite.probes, false);
  const structured = evaluate(suite.pack, suite.probes, true);
  return {
    suite: suite.name,
    files: suite.pack.files.length,
    baseline: report("window", baseline),
    structured: report("structured", structured),
    flip: acceptable(baseline, structured),
  };
});

const shouldFlip = rows.every((row) => row.flip) && USE_STRUCTURED_CHUNKER === false;

const out = {
  flag: USE_STRUCTURED_CHUNKER,
  chunkerVersion: 1,
  shouldFlip,
  reason: shouldFlip
    ? "Structured matches the flip bar on every suite (wrong-intent 0, unsupported 0, hit or silence improved)."
    : "Keep USE_STRUCTURED_CHUNKER = false. Structured is not equal-or-better on the flip bar yet.",
  suites: rows,
};

console.log(JSON.stringify(out, null, 2));
