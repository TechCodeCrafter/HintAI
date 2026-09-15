#!/usr/bin/env node
/**
 * Step 5D validation — fast-path quality + grounded latency analysis.
 * Prints classification summary; answer bodies only to stdout (not persisted).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(readFileSync(join(root, "fixtures/flight-sessions/real-session-baseline-5b1.json"), "utf8"));
const optimized = JSON.parse(readFileSync(join(root, "fixtures/flight-sessions/real-session-latest.json"), "utf8"));

const STOP = new Set(["a", "an", "the", "is", "are", "was", "were", "it", "its", "that", "this", "and", "or", "to", "of", "in", "for", "on", "with", "as", "at", "by", "from"]);

function key(row) {
  return `${row.captureScenario}::${row.query}`;
}

function tokens(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 1;
}

function classifyFastPathQuality(baselineSay, newSay, query) {
  if (!baselineSay?.trim() || !newSay?.trim()) return "materially incomplete";
  const bNorm = baselineSay.toLowerCase().replace(/\s+/g, " ").trim();
  const nNorm = newSay.toLowerCase().replace(/\s+/g, " ").trim();
  if (bNorm === nNorm) return "semantically equivalent";
  if (bNorm.includes(nNorm) || nNorm.includes(bNorm)) {
    return nNorm.length < bNorm.length * 0.75 ? "equivalent but narrower" : "equivalent but more precise";
  }
  const overlap = jaccard(tokens(baselineSay), tokens(newSay));
  if (overlap >= 0.65) return "semantically equivalent";
  if (overlap >= 0.45) {
    return nNorm.length < bNorm.length * 0.8 ? "equivalent but narrower" : "semantically equivalent";
  }
  if (overlap >= 0.3) return "equivalent but narrower";
  // Check if new answer omits key baseline concepts
  const baselineOnly = [...tokens(baselineSay)].filter((t) => !tokens(newSay).has(t));
  const critical = baselineOnly.filter((t) => t.length > 5);
  if (critical.length >= 3 && overlap < 0.35) return "materially incomplete";
  if (overlap < 0.2) return "conflicting";
  return "equivalent but narrower";
}

function pct(vals, q) {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)];
}

const baseMap = new Map(baseline.records.filter((r) => r.kind === "answer").map((r) => [key(r), r]));
const optAnswers = optimized.records.filter((r) => r.kind === "answer");

const bypassed = optAnswers.filter((r) => r.llmBypassed);
const grounded = optAnswers.filter((r) => r.tier === "grounded" && r.supported);

console.log("=== FAST-PATH QUALITY (5D) ===\n");
console.log(`Bypassed traces: ${bypassed.length}\n`);

const counts = {};
const pairs = [];
for (const row of bypassed) {
  const prior = baseMap.get(key(row));
  if (!prior?.say) {
    counts["materially incomplete"] = (counts["materially incomplete"] ?? 0) + 1;
    pairs.push({ scenario: row.captureScenario, query: row.query, class: "materially incomplete (no baseline say)", priorTier: prior?.tier });
    continue;
  }
  const cls = classifyFastPathQuality(prior.say, row.say, row.query);
  counts[cls] = (counts[cls] ?? 0) + 1;
  pairs.push({
    scenario: row.captureScenario,
    query: row.query,
    class: cls,
    priorTier: prior.tier,
    overlap: jaccard(tokens(prior.say), tokens(row.say)).toFixed(2),
  });
}

for (const [cls, n] of Object.entries(counts).sort()) console.log(`  ${cls}: ${n}`);
const acceptable = (counts["semantically equivalent"] ?? 0)
  + (counts["equivalent but narrower"] ?? 0)
  + (counts["equivalent but more precise"] ?? 0);
const rate = bypassed.length ? (acceptable / bypassed.length * 100).toFixed(1) : "0";
console.log(`\nSemantically acceptable (equiv + narrower + more precise): ${acceptable}/${bypassed.length} (${rate}%)`);
console.log(`Conflicting: ${counts.conflicting ?? 0}`);
console.log(`Materially incomplete: ${counts["materially incomplete"] ?? 0}`);

console.log("\n--- Pair detail (manual review) ---");
for (const p of pairs) {
  const prior = baseMap.get(`${p.scenario}::${p.query}`);
  console.log(`\n[${p.class}] ${p.scenario}`);
  console.log(`Q: ${p.query}`);
  console.log(`Prior tier: ${p.priorTier ?? "?"} | overlap: ${p.overlap ?? "n/a"}`);
  if (prior?.say) console.log(`Baseline: ${prior.say.slice(0, 220)}${prior.say.length > 220 ? "…" : ""}`);
  const cur = bypassed.find((r) => r.captureScenario === p.scenario && r.query === p.query);
  if (cur?.say) console.log(`Fast-path: ${cur.say.slice(0, 220)}${cur.say.length > 220 ? "…" : ""}`);
}

console.log("\n\n=== REMAINING GROUNDED TRACES ===\n");
for (const row of grounded) {
  console.log(`Scenario: ${row.captureScenario}`);
  console.log(`Q: ${row.query}`);
  console.log(`Shape: ${row.questionShape} | evidence: ${row.evidenceCount} | sources: ${row.sourceCount}`);
  console.log(`Latency: total=${row.latency.totalMs}ms llm=${row.latency.llmMs}ms`);
  console.log(`Say: ${row.say?.slice(0, 200)}…`);
  console.log("---");
}

function multiSourceSupported(records) {
  return records.filter((r) => r.kind === "answer" && r.supported && r.say && (r.sourceCount ?? 0) > 1);
}

const baseMulti = multiSourceSupported(baseline.records);
const optMulti = multiSourceSupported(optimized.records);

console.log("\n=== MULTI-SOURCE ===\n");
console.log(`Baseline supported multi-source: ${baseMulti.length}`);
console.log(`Optimized supported multi-source: ${optMulti.length}`);

const baseKeys = new Set(baseMulti.map(key));
const optKeys = new Set(optMulti.map(key));
const lost = [...baseKeys].filter((k) => !optKeys.has(k));
const gained = [...optKeys].filter((k) => !baseKeys.has(k));

console.log("\nLost multi-source supported (baseline had, optimized does not):");
for (const k of lost) {
  const b = baseMap.get(k);
  const o = optAnswers.find((r) => key(r) === k);
  console.log(`  ${k}`);
  console.log(`    baseline: tier=${b?.tier} supported=${b?.supported} sources=${b?.sourceCount}`);
  console.log(`    optimized: tier=${o?.tier} supported=${o?.supported} sources=${o?.sourceCount} say=${Boolean(o?.say)}`);
}

console.log("\nGained multi-source supported:");
for (const k of gained) console.log(`  ${k}`);

console.log("\n=== LATENCY SUMMARY ===\n");
const supported = optAnswers.filter((r) => r.supported && r.say);
console.log(`Supported total p50/p95/p99: ${pct(supported.map((r) => r.latency.totalMs), 50)}/${pct(supported.map((r) => r.latency.totalMs), 95)}/${pct(supported.map((r) => r.latency.totalMs), 99)} ms`);
console.log(`Grounded total p95: ${pct(grounded.map((r) => r.latency.totalMs), 95)} ms`);
