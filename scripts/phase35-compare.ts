/**
 * Compare current code-only Cards to the frozen Phase 3.5 snapshots.
 * Read-only: does not write .eval/phase35/.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { persistPackAsContext } from "../src/lib/context/service.ts";
import { createMemoryRepository } from "../src/lib/context/memory.ts";
import { indexContext } from "../src/lib/context/chunk-index.ts";
import { NORTHSTAR } from "../src/lib/repo/northstar.ts";
import { localCard, questionChips } from "../src/lib/search/local-card.ts";
import { citationText } from "../src/lib/search/cite.ts";
import { buildChunks, retrieve } from "../src/lib/search/retrieve.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FROZEN = `${ROOT}.eval/phase35/`;
const pack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));
const COVERAGE = JSON.parse(readFileSync(`${FROZEN}cards-fresh.json`, "utf8")).map((row) => row.query);

function cardSnap(card) {
  return {
    query: card.query,
    say: card.say,
    silent: !card.say,
    reason: card.reason ?? null,
    evidence: (card.evidence ?? []).map((item) =>
      item.kind === "commit"
        ? {
            kind: item.kind,
            sha: item.sha,
            message: item.message,
            author: item.author ?? null,
            date: item.date ?? null,
            pr: item.pr ?? null,
            text: item.text,
          }
        : {
            kind: item.kind,
            path: item.path,
            startLine: item.startLine,
            endLine: item.endLine,
            startOffset: item.startOffset,
            endOffset: item.endOffset,
            text: item.text,
          },
    ),
    citations: card.citations.map((c) =>
      c.kind === "commit"
        ? { kind: c.kind, sha: c.sha, label: c.label ?? null, text: citationText(c) }
        : {
            kind: c.kind,
            path: c.path,
            line: c.line,
            endLine: c.endLine ?? null,
            label: c.label ?? null,
            text: citationText(c),
          },
    ),
  };
}

const frozenChips = JSON.parse(readFileSync(`${FROZEN}northstar-chips.json`, "utf8"));
const chips = questionChips(NORTHSTAR);
const northstarChunks = buildChunks(NORTHSTAR);
const spoken = chips.map((q) => ({
  q,
  snap: cardSnap(localCard(q, retrieve(q, northstarChunks), NORTHSTAR, 0, null)),
}));
const chipDiffs = [];
for (let i = 0; i < frozenChips.length; i += 1) {
  if (JSON.stringify(frozenChips[i]) !== JSON.stringify(spoken[i])) {
    chipDiffs.push(frozenChips[i].q);
  }
}

const repo = createMemoryRepository();
const saved = await persistPackAsContext(pack, repo);
const fresh = await indexContext(repo, saved.context.id);
const freshCards = COVERAGE.map((q) => cardSnap(localCard(q, retrieve(q, fresh.chunks), fresh.pack, 0, null)));
const frozenCards = JSON.parse(readFileSync(`${FROZEN}cards-fresh.json`, "utf8"));
const cardDiffs = [];
for (let i = 0; i < frozenCards.length; i += 1) {
  if (JSON.stringify(frozenCards[i]) !== JSON.stringify(freshCards[i])) {
    cardDiffs.push(frozenCards[i].query);
  }
}

const frozenRetrieval = JSON.parse(readFileSync(`${FROZEN}retrieval-fresh.json`, "utf8"));
const retrievalDiffs = [];
for (const row of frozenRetrieval) {
  const hits = retrieve(row.q, fresh.chunks).slice(0, 6).map((h) => ({
    path: h.path,
    startLine: h.kind === "code" || h.kind === "why" ? h.startLine : undefined,
    endLine: h.kind === "code" || h.kind === "why" ? h.endLine : undefined,
    score: h.score,
    kind: h.kind,
  }));
  if (JSON.stringify(hits) !== JSON.stringify(row.hits)) retrievalDiffs.push(row.q);
}

console.log(JSON.stringify({
  northstarChipDiffs: chipDiffs,
  cardDiffs,
  retrievalDiffs,
  freshChunks: fresh.chunks.length,
  rebuilt: fresh.report.rebuiltSourceCount,
  ok: chipDiffs.length === 0 && cardDiffs.length === 0 && retrievalDiffs.length === 0,
}, null, 2));
if (chipDiffs.length || cardDiffs.length || retrievalDiffs.length) process.exit(1);
