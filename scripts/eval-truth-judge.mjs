#!/usr/bin/env node
/**
 * Offline truth-judge benchmark — experimental only, no production wiring.
 * npm run eval:truth-judge
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "fixtures/evals/truth-judge");

const { createTruthJudge } = await import("../src/lib/truth/index.ts");
const { JevTruthJudge } = await import("../src/lib/truth/jev-judge.ts");
const { LLMTruthJudge } = await import("../src/lib/truth/llm-judge.ts");
const { callJev, consumeJevUsage, jevConfigured, jevDisabledReason, JEV_ENDPOINT } = await import(
  "../src/lib/truth/jev-client.ts"
);
const {
  classificationMetrics,
  applicabilitySafetyMetrics,
  escalationSafetyMetrics,
  percentile,
  thresholdSweep,
  ensembleApplicability,
} = await import("../src/lib/truth/metrics.ts");

const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98];
const LATENCY_REPS = 5;

const judgeArg = process.argv.find((a) => a.startsWith("--judges="))?.slice("--judges=".length);
const requestedJudges = (judgeArg ?? "deterministic,llm").split(",").map((s) => s.trim());

const classification = JSON.parse(readFileSync(join(fixtureDir, "question-classification.json"), "utf8"));
const applicability = JSON.parse(readFileSync(join(fixtureDir, "evidence-applicability.json"), "utf8"));
const escalation = JSON.parse(readFileSync(join(fixtureDir, "escalation.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(fixtureDir, "manifest.json"), "utf8"));

/** @type {Record<string, unknown>} */
const report = {
  generatedAt: new Date().toISOString(),
  branch: "experiment/jev-truth-judge",
  dataset: manifest,
  jevApiVerification: null,
  jevStatus: jevDisabledReason() ?? "enabled",
  missingKeys: [],
  judges: {},
  ensemble: {},
  recommendation: "CONTINUE EXPERIMENT",
  decisionRule: "",
};

// --- Jev API verification ---
report.jevApiVerification = {
  endpoint: JEV_ENDPOINT,
  auth: "Authorization: Bearer <JEV_API_KEY or TYPESAFE_API_KEY>",
  requestSchema: {
    model: "required (default jev-latest)",
    state: "string | object | array",
    questions: "Record<id, { type: choice|noul|score, instructions, criteria? }>",
  },
  responseSchema: {
    answers: "Record<id, { choice?, probabilities?, confidence? } | { noul? } | { score? }>",
    usage: "{ input_tokens?, output_tokens?, cost_usd? }",
  },
  batching: "Multiple questions in one POST supported",
  documentedRateLimits: "~1200 req/min, 250k tokens/sec (TypeSafe docs, Sep 2026)",
  timeoutMs: 15000,
  liveProbe: null,
};

if (!jevConfigured()) {
  report.jevApiVerification.liveProbe = `SKIPPED — ${jevDisabledReason()}`;
} else {
  try {
    const t0 = performance.now();
    const probe = await callJev({
      state: "Probe: evidence says retries are capped at three.",
      questions: {
        applicable: {
          type: "noul",
          instructions: "Does the evidence directly answer why retries happen three times?",
          criteria: { true: "Evidence explicitly supports the question.", false: "Evidence is off-topic or unsupported." },
        },
      },
    });
    const ms = Math.round(performance.now() - t0);
    const usage = consumeJevUsage();
    report.jevApiVerification.liveProbe = {
      ok: true,
      latencyMs: ms,
      noul: probe.answers?.applicable?.noul ?? null,
      usage,
    };
  } catch (err) {
    report.jevApiVerification.liveProbe = { ok: false, error: String(err) };
  }
}

/** @type {Array<"deterministic"|"jev"|"llm">} */
const judgesToRun = [];
for (const kind of requestedJudges) {
  if (kind === "deterministic") judgesToRun.push("deterministic");
  else if (kind === "jev") {
    if (jevConfigured()) judgesToRun.push("jev");
    else console.log(`Jev skipped: ${jevDisabledReason()}`);
  } else if (kind === "llm") {
    if (LLMTruthJudge.available()) judgesToRun.push("llm");
    else {
      report.missingKeys.push("OPENAI_API_KEY, ANTHROPIC_API_KEY, or XAI_API_KEY");
      console.log("LLM skipped: no API key");
    }
  }
}
if (judgesToRun.length === 0) judgesToRun.push("deterministic");

/** @type {Record<string, { applicability: Array<unknown> }>} */
const caseResults = {};

for (const kind of judgesToRun) {
  const judge = createTruthJudge(kind);
  console.log(`\n=== ${kind} ===`);
  let jevCostUsd = 0;
  let jevInputTokens = 0;

  // Classification
  /** @type {Array<{id:string,expected:string,predicted:string,confidence?:number,latencyMs:number}>} */
  const classCases = [];
  for (const row of classification) {
    const t0 = performance.now();
    const result = await judge.classifyQuestion({ question: row.question, context: row.context });
    classCases.push({
      id: row.id,
      expected: row.expectedClass,
      predicted: result.class,
      confidence: result.confidence,
      latencyMs: result.latencyMs ?? Math.round(performance.now() - t0),
    });
    if (kind === "jev") {
      const u = consumeJevUsage();
      if (u?.cost_usd) jevCostUsd += u.cost_usd;
      if (u?.input_tokens) jevInputTokens += u.input_tokens;
    }
  }
  const classMetrics = classificationMetrics(classCases.map((c) => ({ expected: c.expected, predicted: c.predicted })));

  // Applicability
  /** @type {Array<{id:string,question:string,evidence:object,expected:string,predicted:string,confidence?:number,latencyMs:number,note?:string}>} */
  const appCases = [];
  /** @type {Array<{confidence:number,expectedContinue:boolean}>} */
  const appThresholdRows = [];
  for (const row of applicability) {
    const t0 = performance.now();
    const result = await judge.assessApplicability({ question: row.question, evidence: row.evidence });
    const rawConf = result.confidence ?? (result.decision === "APPLICABLE" ? 0.75 : 0.25);
    const applicableProbability =
      result.decision === "APPLICABLE" ? rawConf : 1 - rawConf;
    appCases.push({
      id: row.id,
      question: row.question,
      evidence: row.evidence,
      expected: row.expected,
      predicted: result.decision,
      confidence: rawConf,
      applicableProbability,
      latencyMs: result.latencyMs ?? Math.round(performance.now() - t0),
      note: row.note,
    });
    appThresholdRows.push({
      confidence: applicableProbability,
      expectedContinue: row.expected === "APPLICABLE",
    });
    if (kind === "jev") {
      const u = consumeJevUsage();
      if (u?.cost_usd) jevCostUsd += u.cost_usd;
      if (u?.input_tokens) jevInputTokens += u.input_tokens;
    }
  }
  const appMetrics = applicabilitySafetyMetrics(
    appCases.map((c) => ({ expected: c.expected, predicted: c.predicted })),
  );
  const unsafeCases = appCases.filter((c) => c.expected === "NOT_APPLICABLE" && c.predicted === "APPLICABLE");

  // Escalation
  /** @type {Array<{id:string,expected:string,predicted:string,confidence?:number,latencyMs:number}>} */
  const escCases = [];
  for (const row of escalation) {
    const t0 = performance.now();
    const result = await judge.assessEscalation({ question: row.question, topEvidence: row.topEvidence });
    escCases.push({
      id: row.id,
      expected: row.expected,
      predicted: result.decision,
      confidence: result.confidence,
      latencyMs: result.latencyMs ?? Math.round(performance.now() - t0),
    });
    if (kind === "jev") {
      const u = consumeJevUsage();
      if (u?.cost_usd) jevCostUsd += u.cost_usd;
      if (u?.input_tokens) jevInputTokens += u.input_tokens;
    }
  }
  const escMetrics = escalationSafetyMetrics(escCases.map((c) => ({ expected: c.expected, predicted: c.predicted })));

  const thresholdRows = thresholdSweep(appThresholdRows, THRESHOLDS);

  // Latency subsample (repeated calls on first case per task)
  const latencyBench = { classification: [], applicability: [], escalation: [], jevBatch: null };
  if (kind === "jev" && jevConfigured()) {
    const sample = classification[0];
    for (let i = 0; i < LATENCY_REPS; i++) {
      const t0 = performance.now();
      await judge.classifyQuestion({ question: sample.question, context: sample.context });
      latencyBench.classification.push(Math.round(performance.now() - t0));
      consumeJevUsage();
    }
    const appSample = applicability[0];
    for (let i = 0; i < LATENCY_REPS; i++) {
      const t0 = performance.now();
      await judge.assessApplicability({ question: appSample.question, evidence: appSample.evidence });
      latencyBench.applicability.push(Math.round(performance.now() - t0));
      consumeJevUsage();
    }
    const escSample = escalation[0];
    for (let i = 0; i < LATENCY_REPS; i++) {
      const t0 = performance.now();
      await judge.assessEscalation({ question: escSample.question, topEvidence: escSample.topEvidence });
      latencyBench.escalation.push(Math.round(performance.now() - t0));
      consumeJevUsage();
    }
    // Batch vs separate on one applicability state
    const state = JSON.stringify({ question: appSample.question, evidence: appSample.evidence });
    const tSep = performance.now();
    await callJev({
      state,
      questions: {
        applicable: {
          type: "noul",
          instructions: "Does evidence directly answer the question?",
          criteria: { true: "Supported", false: "Not supported" },
        },
      },
    });
    consumeJevUsage();
    const sepMs = Math.round(performance.now() - tSep);
    const tBatch = performance.now();
    await callJev({
      state,
      questions: {
        q1: { type: "noul", instructions: "Q1", criteria: { true: "yes", false: "no" } },
        q2: { type: "noul", instructions: "Q2", criteria: { true: "yes", false: "no" } },
        q3: { type: "noul", instructions: "Q3", criteria: { true: "yes", false: "no" } },
      },
    });
    consumeJevUsage();
    latencyBench.jevBatch = { separateOneQuestionMs: sepMs, batchThreeQuestionsMs: Math.round(performance.now() - tBatch) };
  }

  const classLat = classCases.map((c) => c.latencyMs);
  const appLat = appCases.map((c) => c.latencyMs);
  const escLat = escCases.map((c) => c.latencyMs);

  const totalCalls = classification.length + applicability.length + escalation.length;
  const cost = {
    measuredTotalUsd: kind === "jev" ? jevCostUsd : null,
    measuredInputTokens: kind === "jev" ? jevInputTokens : null,
    estimatedPer1000QuestionsUsd: kind === "jev" && jevCostUsd > 0 ? (jevCostUsd / totalCalls) * 1000 : null,
    estimatedPer10000QuestionsUsd: kind === "jev" && jevCostUsd > 0 ? (jevCostUsd / totalCalls) * 10000 : null,
    note: kind === "llm" ? "LLM provider does not expose per-call cost in synthesis-client — not estimated" : undefined,
  };

  report.judges[kind] = {
    question_classification: {
      ...classMetrics,
      cases: classCases,
      latencyMs: latStats(classLat),
      latencyBench: latencyBench.classification.length ? latStats(latencyBench.classification) : undefined,
    },
    evidence_applicability: {
      ...appMetrics,
      falseApplicable: appMetrics.falseApplicability,
      falseNotApplicable: appMetrics.falseSilence,
      unsafeContinuationCases: unsafeCases.map((c) => ({
        id: c.id,
        question: c.question,
        evidenceExcerpt: excerpt(c.evidence),
        expected: c.expected,
        predicted: c.predicted,
        confidence: c.confidence,
        provider: kind,
      })),
      thresholdSweep: thresholdRows,
      cases: appCases,
      latencyMs: latStats(appLat),
      latencyBench: latencyBench.applicability.length ? latStats(latencyBench.applicability) : undefined,
    },
    escalation: {
      ...escMetrics,
      cases: escCases,
      latencyMs: latStats(escLat),
      latencyBench: latencyBench.escalation.length ? latStats(latencyBench.escalation) : undefined,
    },
    cost,
    jevBatchLatency: latencyBench.jevBatch,
  };

  caseResults[kind] = { applicability: appCases };

  console.log(`classification accuracy: ${(classMetrics.accuracy * 100).toFixed(1)}%`);
  console.log(`applicability unsafe continuation: ${(appMetrics.unsafeContinuationRate * 100).toFixed(2)}%`);
  console.log(`escalation unsafe continuation: ${(escMetrics.unsafeContinuationRate * 100).toFixed(2)}%`);
  console.log(`safe coverage (app): ${(appMetrics.safeCoverage * 100).toFixed(1)}%`);
  console.log(`latency p95 (app): ${latStats(appLat).p95}ms`);
}

// Ensemble: Deterministic + Jev (Jev may only reject)
if (report.judges.deterministic && report.judges.jev) {
  const detCases = caseResults.deterministic.applicability;
  const jevCases = caseResults.jev.applicability;
  const byId = Object.fromEntries(jevCases.map((c) => [c.id, c]));
  const ensembleRows = detCases.map((d) => ({
    id: d.id,
    expected: d.expected,
    deterministic: d.predicted,
    jev: byId[d.id]?.predicted ?? "NOT_APPLICABLE",
    question: d.question,
    evidence: d.evidence,
    note: d.note,
  }));
  const merged = ensembleApplicability(
    ensembleRows.map((r) => ({
      deterministic: r.deterministic,
      jev: r.jev,
    })),
  );
  const pairs = ensembleRows.map((r, i) => ({
    expected: r.expected,
    predicted: merged[i].predicted,
  }));
  const ensMetrics = applicabilitySafetyMetrics(pairs);
  report.ensemble["deterministic+jev"] = {
    policy: "If deterministic NOT_APPLICABLE → stay NOT_APPLICABLE. If APPLICABLE → Jev may confirm or downgrade.",
    ...ensMetrics,
    unsafeContinuationCases: ensembleRows
      .map((r, i) => ({ ...r, predicted: merged[i].predicted }))
      .filter((c) => c.expected === "NOT_APPLICABLE" && c.predicted === "APPLICABLE")
      .map((c) => ({
        id: c.id,
        question: c.question,
        evidenceExcerpt: excerpt(c.evidence),
        expected: c.expected,
        predicted: c.predicted,
        deterministic: c.deterministic,
        jev: c.jev,
      })),
  };
  console.log(`\n=== ensemble deterministic+jev ===`);
  console.log(`applicability unsafe continuation: ${(ensMetrics.unsafeContinuationRate * 100).toFixed(2)}%`);
  console.log(`safe coverage: ${(ensMetrics.safeCoverage * 100).toFixed(1)}%`);
}

// Failure analysis
report.failureAnalysis = buildFailureAnalysis(report.judges, applicability);

// Decision table + recommendation
report.decisionTable = buildDecisionTable(report);
report.recommendation = decideRecommendation(report);
report.decisionRule = buildDecisionRule(report);

const outJson = join(root, "fixtures/evals/truth-judge/latest-report.json");
writeFileSync(outJson, JSON.stringify(report, null, 2));

const mdPath = join(root, "docs/experiments/JEV-TRUTH-JUDGE-REPORT.md");
mkdirSync(dirname(mdPath), { recursive: true });
writeFileSync(mdPath, renderMarkdown(report));

console.log(`\nWrote ${outJson}`);
console.log(`Wrote ${mdPath}`);
console.log(`Recommendation: ${report.recommendation}`);
if (report.jevStatus && !jevConfigured()) console.log(`Jev: ${report.jevStatus}`);
if (report.missingKeys.length) console.log(`Missing keys: ${report.missingKeys.join(", ")}`);

function latStats(values) {
  return { p50: percentile(values, 50), p95: percentile(values, 95), p99: percentile(values, 99), n: values.length };
}

function excerpt(evidence) {
  const text = typeof evidence?.text === "string" ? evidence.text : "";
  const path = evidence?.path ?? "";
  return `${path}: ${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`;
}

function pct(n) {
  return `${(Number(n) * 100).toFixed(2)}%`;
}

function buildDecisionTable(r) {
  const rows = [];
  for (const [name, key] of [
    ["Deterministic", "deterministic"],
    ["Jev", "jev"],
    ["LLM", "llm"],
    ["Deterministic + Jev", "ensemble"],
  ]) {
    if (key === "ensemble") {
      const e = r.ensemble["deterministic+jev"];
      if (!e) continue;
      rows.push({
        judge: name,
        applicabilityAccuracy: e.accuracy,
        unsafeContinuation: e.unsafeContinuationRate,
        safeCoverage: e.safeCoverage,
        p95: "—",
        costPer1k: r.judges.jev?.cost?.estimatedPer1000QuestionsUsd ?? null,
      });
      continue;
    }
    const j = r.judges[key];
    if (!j) continue;
    rows.push({
      judge: name,
      applicabilityAccuracy: j.evidence_applicability.accuracy,
      unsafeContinuation: j.evidence_applicability.unsafeContinuationRate,
      safeCoverage: j.evidence_applicability.safeCoverage,
      p95: j.evidence_applicability.latencyMs.p95,
      costPer1k: j.cost?.estimatedPer1000QuestionsUsd ?? null,
    });
  }
  return rows;
}

function decideRecommendation(r) {
  if (!r.judges.jev) {
    return r.jevStatus?.includes("disabled")
      ? "CONTINUE EXPERIMENT — Jev disabled pending TypeSafe early access (deterministic + LLM baseline only)"
      : "CONTINUE EXPERIMENT — Jev not run (see jevStatus in report)";
  }
  const baseline = r.judges.deterministic?.evidence_applicability?.unsafeContinuationRate ?? 0.4125;
  const candidates = [
    { name: "jev", data: r.judges.jev?.evidence_applicability },
    { name: "ensemble", data: r.ensemble["deterministic+jev"] },
  ].filter((c) => c.data);
  for (const c of candidates) {
    const d = c.data;
    const materialReduction = d.unsafeContinuationRate < baseline * 0.7;
    const usefulCoverage = d.safeCoverage >= 0.35;
    const p95 = c.name === "jev" ? r.judges.jev.evidence_applicability.latencyMs.p95 : 9999;
    const acceptableLatency = p95 <= 3000;
    const cost = r.judges.jev?.cost?.estimatedPer1000QuestionsUsd;
    const acceptableCost = cost == null || cost <= 5;
    if (materialReduction && usefulCoverage && acceptableLatency && acceptableCost && d.unsafeContinuationRate <= baseline) {
      return `CANDIDATE FOR FEATURE FLAG (${c.name})`;
    }
  }
  const jevUnsafe = r.judges.jev?.evidence_applicability?.unsafeContinuationRate;
  if (jevUnsafe != null && jevUnsafe > baseline * 1.1) return "KILL";
  return "CONTINUE EXPERIMENT";
}

function buildDecisionRule(r) {
  return [
    "Feature flag candidate only if unsafe continuation materially below 41.25% baseline, safe coverage useful, acceptable p95/cost/privacy.",
    "No production merge in this milestone.",
    r.jevStatus && r.jevStatus !== "enabled" ? r.jevStatus : r.missingKeys.length ? `Missing: ${r.missingKeys.join("; ")}` : "All requested judges ran.",
  ].join(" ");
}

function inferFailureReason(caseRow) {
  const note = caseRow.note ?? "";
  const q = (caseRow.question ?? "").toLowerCase();
  const text = (caseRow.evidence?.text ?? "").toLowerCase();
  if (note) return note;
  if (/\b(not|never|without|except)\b/.test(text)) return "negation";
  if (q.split(/\s+/).filter((w) => text.includes(w)).length >= 2 && caseRow.expected === "NOT_APPLICABLE") {
    return "semantic similarity but wrong meaning";
  }
  return "overlap heuristic / verifyClaim mismatch";
}

function buildFailureAnalysis(judges, appFixtures) {
  const sections = {};
  for (const [kind, prefix] of [
    ["jev", "JEV"],
    ["llm", "LLM"],
    ["deterministic", "DETERMINISTIC"],
  ]) {
    const j = judges[kind];
    if (!j) continue;
    const cases = j.evidence_applicability.cases;
    const fp = cases.filter((c) => c.expected === "NOT_APPLICABLE" && c.predicted === "APPLICABLE");
    const fn = cases.filter((c) => c.expected === "APPLICABLE" && c.predicted === "NOT_APPLICABLE");
    sections[`${prefix} FALSE POSITIVES`] = worstN(fp, 10).map((c) => ({
      id: c.id,
      question: c.question,
      excerpt: excerpt(c.evidence),
      expected: c.expected,
      predicted: c.predicted,
      confidence: c.confidence,
      likelyReason: inferFailureReason(c),
    }));
    sections[`${prefix} FALSE NEGATIVES`] = worstN(fn, 10).map((c) => ({
      id: c.id,
      question: c.question,
      excerpt: excerpt(c.evidence),
      expected: c.expected,
      predicted: c.predicted,
      confidence: c.confidence,
      likelyReason: inferFailureReason(c),
    }));
  }
  return sections;
}

function worstN(arr, n) {
  return [...arr].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, n);
}

function renderMarkdown(r) {
  const lines = [
    "# Jev Truth Judge — Benchmark Report",
    "",
    `_Generated: ${r.generatedAt}_`,
    "",
    "## Recommendation",
    "",
    `**${r.recommendation}**`,
    "",
    r.decisionRule,
    "",
  ];

  if (r.jevStatus && r.jevStatus !== "enabled") {
    lines.push("## Jev status", "", r.jevStatus, "", "_Jev is opt-in only. No Jev results were fabricated._", "");
  }
  if (r.missingKeys?.length) {
    lines.push("## Missing API keys", "", ...r.missingKeys.map((k) => `- \`${k}\``), "");
  }

  lines.push("## Jev API verification", "", "| Field | Value |", "|-------|-------|");
  const v = r.jevApiVerification;
  lines.push(`| Endpoint | \`${v.endpoint}\` |`);
  lines.push(`| Auth | ${v.auth} |`);
  lines.push(`| Batching | ${v.batching} |`);
  lines.push(`| Rate limits (documented) | ${v.documentedRateLimits} |`);
  lines.push(`| Live probe | ${JSON.stringify(v.liveProbe)} |`, "");

  lines.push("## Decision table", "", "| Judge | Applicability accuracy | Unsafe continuation | Safe coverage | p95 (ms) | Cost/1k |");
  lines.push("|-------|------------------------|--------------------|--------------|---------|---------|");
  for (const row of r.decisionTable ?? []) {
    lines.push(
      `| ${row.judge} | ${pct(row.applicabilityAccuracy)} | ${pct(row.unsafeContinuation)} | ${pct(row.safeCoverage)} | ${row.p95 ?? "—"} | ${row.costPer1k != null ? `$${row.costPer1k.toFixed(4)}` : "—"} |`,
    );
  }
  lines.push("");

  for (const [kind, data] of Object.entries(r.judges)) {
    lines.push(`## ${kind}`, "");
    renderTaskSection(lines, "A. Question classification", data.question_classification, "classification");
    renderTaskSection(lines, "B. Evidence applicability", data.evidence_applicability, "applicability");
    renderTaskSection(lines, "C. Escalation", data.escalation, "escalation");
    if (data.cost) {
      lines.push("### Cost", "");
      lines.push(`- Measured total USD: ${data.cost.measuredTotalUsd ?? "n/a"}`);
      lines.push(`- Est. per 1,000 questions: ${data.cost.estimatedPer1000QuestionsUsd ?? "n/a"}`);
      lines.push(`- Est. per 10,000 questions: ${data.cost.estimatedPer10000QuestionsUsd ?? "n/a"}`);
      if (data.cost.note) lines.push(`- ${data.cost.note}`);
      lines.push("");
    }
    if (data.jevBatchLatency) {
      lines.push("### Jev batch latency (measured)", "");
      lines.push(`- 1 question: ${data.jevBatchLatency.separateOneQuestionMs}ms`);
      lines.push(`- 3 questions (one state): ${data.jevBatchLatency.batchThreeQuestionsMs}ms`, "");
    }
  }

  if (r.ensemble["deterministic+jev"]) {
    const e = r.ensemble["deterministic+jev"];
    lines.push("## Ensemble: Deterministic + Jev", "", e.policy, "");
    lines.push(`- Unsafe continuation: ${pct(e.unsafeContinuationRate)} (${e.unsafeContinuation}/${e.total})`);
    lines.push(`- Safe coverage: ${pct(e.safeCoverage)}`);
    lines.push(`- Refusal rate: ${pct(e.refusalRate)}`, "");
  }

  lines.push("## Unsafe continuation cases (applicability)", "");
  for (const kind of ["deterministic", "jev", "llm"]) {
    const cases = r.judges[kind]?.evidence_applicability?.unsafeContinuationCases ?? [];
    if (!cases.length) continue;
    lines.push(`### ${kind} (${cases.length})`, "");
    for (const c of cases) {
      lines.push(`- **${c.id}** — Q: ${c.question}`);
      lines.push(`  - Evidence: ${c.evidenceExcerpt}`);
      lines.push(`  - Expected: ${c.expected} → Predicted: ${c.predicted} (conf: ${c.confidence?.toFixed?.(2) ?? "n/a"})`);
    }
    lines.push("");
  }

  lines.push("## Failure analysis", "");
  for (const [title, items] of Object.entries(r.failureAnalysis ?? {})) {
    lines.push(`### ${title}`, "");
    if (!items?.length) {
      lines.push("_None_", "");
      continue;
    }
    for (const item of items) {
      lines.push(`- **${item.id}** (${item.likelyReason}): ${item.question}`);
      lines.push(`  - ${item.excerpt}`);
      lines.push(`  - expected ${item.expected}, got ${item.predicted}, conf ${item.confidence?.toFixed?.(2) ?? "n/a"}`);
    }
    lines.push("");
  }

  lines.push("## Baseline reference", "", "- Deterministic classification accuracy: 80%", "- Applicability unsafe continuation: 41.25%", "- Escalation unsafe continuation: 0%", "");
  lines.push("See [JEV-EVALUATION.md](./JEV-EVALUATION.md) for privacy and kill criteria.", "");
  return lines.join("\n");
}

function renderTaskSection(lines, title, metrics, task) {
  lines.push(`### ${title}`, "");
  lines.push(`- Accuracy: ${pct(metrics.accuracy)}`);
  if (task === "classification") {
    lines.push(`- Macro precision: ${pct(metrics.macroPrecision)}`);
    lines.push(`- Macro recall: ${pct(metrics.macroRecall)}`);
    lines.push("- Confusion matrix:", "");
    for (const [exp, row] of Object.entries(metrics.confusion ?? {})) {
      lines.push(`  - \`${exp}\` → ${JSON.stringify(row)}`);
    }
  }
  if (task === "applicability") {
    lines.push(`- Precision: ${pct(metrics.precision)}`);
    lines.push(`- Recall: ${pct(metrics.recall)}`);
    lines.push(`- False applicable (unsafe): ${metrics.falseApplicable ?? metrics.falseApplicability}`);
    lines.push(`- False not-applicable: ${metrics.falseNotApplicable ?? metrics.falseSilence}`);
    lines.push(`- **Unsafe continuation: ${pct(metrics.unsafeContinuationRate)}** (${metrics.unsafeContinuation}/${metrics.total})`);
    lines.push(`- Safe coverage: ${pct(metrics.safeCoverage)}`);
    lines.push(`- Refusal rate: ${pct(metrics.refusalRate)}`);
    if (metrics.thresholdSweep?.length) {
      lines.push("", "| Threshold | Unsafe | Correct continue | False silence | Coverage | Silence |", "|-----------|--------|------------------|---------------|----------|---------|");
      for (const row of metrics.thresholdSweep) {
        lines.push(
          `| ${row.threshold} | ${pct(row.unsafeContinuationRate)} | ${pct(row.correctContinuationRate)} | ${pct(row.falseSilenceRate)} | ${pct(row.coverageRate)} | ${pct(row.silenceRate)} |`,
        );
      }
    }
  }
  if (task === "escalation") {
    lines.push(`- ANSWER precision: ${pct(metrics.precision)}`);
    lines.push(`- ESCALATE rate: ${pct(metrics.escalateRate)}`);
    lines.push(`- SILENT rate: ${pct(metrics.silentRate)}`);
    lines.push(`- Unsafe continuation: ${pct(metrics.unsafeContinuationRate)}`);
    lines.push(`- Safe coverage: ${pct(metrics.safeCoverage)}`);
  }
  const lat = metrics.latencyMs;
  lines.push(`- Latency p50/p95/p99: ${lat.p50}/${lat.p95}/${lat.p99} ms (n=${lat.n})`, "");
}
