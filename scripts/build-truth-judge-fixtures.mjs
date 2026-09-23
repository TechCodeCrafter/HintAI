#!/usr/bin/env node
/**
 * Emit labelled truth-judge fixtures. Labels are hand-authored in this file — not LLM-generated.
 * node scripts/build-truth-judge-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "fixtures/evals/truth-judge");

/** @type {Array<{id:string,question:string,context?:string[],expectedClass:string,note?:string}>} */
const QUESTION_CLASSIFICATION = [
  { id: "qc-001", question: "What is the architecture of this application?", expectedClass: "architecture", note: "northstar home chip" },
  { id: "qc-002", question: "What does the auth service do?", expectedClass: "product_capability" },
  { id: "qc-003", question: "Where is retry logic implemented?", expectedClass: "implementation" },
  { id: "qc-004", question: "Why does that retry three times?", expectedClass: "general_technical_reasoning" },
  { id: "qc-005", question: "How does session cookie rotation work?", expectedClass: "security_compliance" },
  { id: "qc-006", question: "What is our uptime SLA for exports?", expectedClass: "contractual_sla" },
  { id: "qc-007", question: "How much does the enterprise plan cost?", expectedClass: "pricing_packaging" },
  { id: "qc-008", question: "What is the weather in Paris today?", expectedClass: "current_external_fact" },
  { id: "qc-009", question: "Who owns the settlement exporter module?", expectedClass: "implementation" },
  { id: "qc-010", question: "What components live under src/exporter?", expectedClass: "architecture" },
  { id: "qc-011", question: "What happens when the upload fails?", expectedClass: "general_technical_reasoning" },
  { id: "qc-012", question: "Is OAuth configured for the dashboard?", expectedClass: "security_compliance" },
  { id: "qc-013", question: "Where is the refund policy defined?", expectedClass: "implementation" },
  { id: "qc-014", question: "What did we change in the exporter?", expectedClass: "implementation" },
  { id: "qc-015", question: "Do we encrypt settlement files at rest?", expectedClass: "security_compliance" },
  { id: "qc-016", question: "What liability cap is in the MSA?", expectedClass: "contractual_sla" },
  { id: "qc-017", question: "How many seats are included in Pro?", expectedClass: "pricing_packaging" },
  { id: "qc-018", question: "Who won the World Series last year?", expectedClass: "current_external_fact" },
  { id: "qc-019", question: "What is the capital of France?", expectedClass: "current_external_fact" },
  { id: "qc-020", question: "Can you summarize this repo layout?", expectedClass: "architecture" },
  { id: "qc-021", question: "What capabilities does the edge auth layer expose?", expectedClass: "product_capability" },
  { id: "qc-022", question: "Which file defines PAY-219 runbook steps?", expectedClass: "implementation" },
  { id: "qc-023", question: "Why was dead-letter replay chosen?", expectedClass: "general_technical_reasoning" },
  { id: "qc-024", question: "Are we SOC 2 compliant for auth logs?", expectedClass: "security_compliance" },
  { id: "qc-025", question: "What response time is guaranteed in the contract?", expectedClass: "contractual_sla" },
  { id: "qc-026", question: "What is the per-seat price for annual billing?", expectedClass: "pricing_packaging" },
  { id: "qc-027", question: "What's the stock price of Acme Corp?", expectedClass: "current_external_fact" },
  { id: "qc-028", question: "How do I run the nightly export locally?", expectedClass: "implementation" },
  { id: "qc-029", question: "What is Northstar Payments responsible for?", expectedClass: "product_capability" },
  { id: "qc-030", question: "Where does CSV generation happen?", expectedClass: "implementation" },
  { id: "qc-031", question: "What is the system design for settlement uploads?", expectedClass: "architecture" },
  { id: "qc-032", question: "Why cap attempts at three?", expectedClass: "general_technical_reasoning" },
  { id: "qc-033", question: "Does auth verify cookies on every request?", expectedClass: "security_compliance" },
  { id: "qc-034", question: "What terms govern data retention?", expectedClass: "contractual_sla" },
  { id: "qc-035", question: "Is there a free tier?", expectedClass: "pricing_packaging" },
  { id: "qc-036", question: "What's the temperature today?", expectedClass: "current_external_fact" },
  { id: "qc-037", question: "Who wrote the auth middleware?", expectedClass: "implementation" },
  { id: "qc-038", question: "What does the exporter manage?", expectedClass: "product_capability" },
  { id: "qc-039", question: "How is the operator dashboard guarded?", expectedClass: "security_compliance" },
  { id: "qc-040", question: "Thanks everyone, see you tomorrow.", expectedClass: "other", note: "chatter" },
];

const RETRY_DOC = `Attempts are capped at three because the payment gateway stalls rather than failing fast.`;
const AUTH_DOC = `The auth service verifies the session cookie on every non-public request and rotates it on the way out.`;
const README = `Northstar exports merchant settlement files to S3 and guards the operator dashboard with edge auth.`;
const WEATHER = `The weather in Paris is sunny with mild winds.`;
const PRICING_DOC = `Enterprise plan is billed annually at twelve hundred dollars per seat.`;
const SLA_DOC = `We guarantee 99.9% uptime for export API availability per contract section 4.2.`;

/** @type {Array<{id:string,question:string,evidence:{path:string,text:string,score?:number},expected:"APPLICABLE"|"NOT_APPLICABLE",note?:string}>} */
const EVIDENCE_APPLICABILITY = [
  { id: "ea-001", question: "Why does that retry three times?", evidence: { path: "src/exporter/retry.ts", text: RETRY_DOC }, expected: "APPLICABLE" },
  { id: "ea-002", question: "What does the auth service do?", evidence: { path: "src/auth.ts", text: AUTH_DOC }, expected: "APPLICABLE" },
  { id: "ea-003", question: "What is the architecture?", evidence: { path: "README.md", text: README }, expected: "APPLICABLE" },
  { id: "ea-004", question: "What is the weather today?", evidence: { path: "README.md", text: README }, expected: "NOT_APPLICABLE", note: "off-topic" },
  { id: "ea-005", question: "Why does that retry three times?", evidence: { path: "src/auth.ts", text: AUTH_DOC }, expected: "NOT_APPLICABLE", note: "wrong source" },
  { id: "ea-006", question: "Where is retry logic?", evidence: { path: "src/exporter/retry.ts", text: RETRY_DOC }, expected: "APPLICABLE" },
  { id: "ea-007", question: "What is enterprise pricing?", evidence: { path: "docs/pricing.md", text: PRICING_DOC }, expected: "APPLICABLE" },
  { id: "ea-008", question: "What is enterprise pricing?", evidence: { path: "src/exporter/retry.ts", text: RETRY_DOC }, expected: "NOT_APPLICABLE" },
  { id: "ea-009", question: "What uptime is guaranteed?", evidence: { path: "docs/sla.md", text: SLA_DOC }, expected: "APPLICABLE" },
  { id: "ea-010", question: "What uptime is guaranteed?", evidence: { path: "tests/retry.test.ts", text: "expect(retries).toBe(3)" }, expected: "NOT_APPLICABLE", note: "test vs contract" },
];

function expandApplicability(base, startId) {
  const variants = [
    { q: "How does cookie rotation work?", good: AUTH_DOC, bad: RETRY_DOC, goodPath: "src/auth.ts", badPath: "src/exporter/retry.ts" },
    { q: "What happens on export failure?", good: "Failures land in the dead-letter queue and are replayed.", bad: AUTH_DOC, goodPath: "README.md", badPath: "src/auth.ts" },
    { q: "Where is settlement CSV built?", good: "builds the settlement CSV and uploads it", bad: WEATHER, goodPath: "README.md", badPath: "external/weather.txt" },
    { q: "Is auth checked on every request?", good: AUTH_DOC, bad: PRICING_DOC, goodPath: "src/auth.ts", badPath: "docs/pricing.md" },
    { q: "What is the retry cap?", good: RETRY_DOC, bad: "export const token = 'demo';", goodPath: "src/exporter/retry.ts", badPath: "src/demo.ts" },
    { q: "What does Northstar export?", good: README, bad: SLA_DOC, goodPath: "README.md", badPath: "docs/sla.md" },
    { q: "Who verifies sessions?", good: AUTH_DOC, bad: "describe('retry', () => {})", goodPath: "src/auth.ts", badPath: "tests/auth.test.ts" },
    { q: "What is PAY-219?", good: "replayed from the PAY-219 runbook", bad: RETRY_DOC, goodPath: "README.md", badPath: "src/exporter/retry.ts" },
  ];
  const out = [...base];
  let n = startId;
  for (let round = 0; round < 3; round++) {
    for (const v of variants) {
      const suffix = round === 0 ? "" : ` (variant ${round + 1})`;
      out.push({
        id: `ea-${String(n++).padStart(3, "0")}`,
        question: `${v.q}${suffix}`,
        evidence: { path: v.goodPath, text: v.good },
        expected: "APPLICABLE",
      });
      out.push({
        id: `ea-${String(n++).padStart(3, "0")}`,
        question: `${v.q}${suffix}`,
        evidence: { path: v.badPath, text: v.bad },
        expected: "NOT_APPLICABLE",
      });
    }
  }
  // Negation / version drift / partial support extras
  const extras = [
    { id: `ea-${n++}`, question: "Why does that retry three times?", evidence: { path: "src/exporter/retry.ts", text: "Attempts are capped at four." }, expected: "NOT_APPLICABLE", note: "numeric drift" },
    { id: `ea-${n++}`, question: "Why does that retry three times?", evidence: { path: "src/exporter/retry.ts", text: "Attempts are not capped at three." }, expected: "NOT_APPLICABLE", note: "negation" },
    { id: `ea-${n++}`, question: "What owns authentication?", evidence: { path: "README.md", text: "src/auth — verifies and rotates session cookies" }, expected: "APPLICABLE", note: "partial support" },
    { id: `ea-${n++}`, question: "What owns authentication?", evidence: { path: "README.md", text: "Settlement exports run nightly." }, expected: "NOT_APPLICABLE", note: "irrelevant similarity" },
    { id: `ea-${n++}`, question: "What is Zylorp headquarters address?", evidence: { path: "README.md", text: README }, expected: "NOT_APPLICABLE", note: "unsupported" },
    { id: `ea-${n++}`, question: "What is Zylorp headquarters address?", evidence: { path: "external/zylorp.txt", text: "123 Main St" }, expected: "APPLICABLE", note: "exact supported in wrong corpus item" },
    { id: `ea-${n++}`, question: "What version is retry policy?", evidence: { path: "src/exporter/retry.ts", text: "Policy v2 caps attempts at three." }, expected: "APPLICABLE", note: "version mention ok" },
    { id: `ea-${n++}`, question: "What version is retry policy?", evidence: { path: "src/exporter/retry.ts", text: "Policy v3 caps attempts at three." }, expected: "NOT_APPLICABLE", note: "version mismatch" },
    { id: `ea-${n++}`, question: "Does README mention S3?", evidence: { path: "README.md", text: "exports merchant settlement files to S3" }, expected: "APPLICABLE" },
    { id: `ea-${n++}`, question: "Does README mention S3?", evidence: { path: "README.md", text: "guards the operator dashboard" }, expected: "NOT_APPLICABLE", note: "partial unrelated sentence" },
    { id: `ea-${n++}`, question: "What handles dead-letter replay?", evidence: { path: "README.md", text: "Failures land in the dead-letter queue and are replayed" }, expected: "APPLICABLE" },
    { id: `ea-${n++}`, question: "What handles dead-letter replay?", evidence: { path: "src/exporter/retry.ts", text: RETRY_DOC }, expected: "NOT_APPLICABLE", note: "related wrong module" },
    { id: `ea-${n++}`, question: "Is session rotated on exit?", evidence: { path: "src/auth.ts", text: "rotates it on the way out" }, expected: "APPLICABLE" },
    { id: `ea-${n++}`, question: "Is session rotated on exit?", evidence: { path: "src/exporter/retry.ts", text: "on the way out" }, expected: "NOT_APPLICABLE", note: "phrase collision" },
    { id: `ea-${n++}`, question: "What is edge auth purpose?", evidence: { path: "README.md", text: "guards the operator dashboard with edge auth" }, expected: "APPLICABLE" },
    { id: `ea-${n++}`, question: "What is edge auth purpose?", evidence: { path: "docs/pricing.md", text: PRICING_DOC }, expected: "NOT_APPLICABLE" },
    { id: `ea-${n++}`, question: "How many export attempts?", evidence: { path: "src/exporter/retry.ts", text: "capped at three" }, expected: "APPLICABLE" },
    { id: `ea-${n++}`, question: "How many export attempts?", evidence: { path: "tests/retry.test.ts", text: "toBe(3)" }, expected: "NOT_APPLICABLE", note: "test assertion not doc" },
    { id: `ea-${n++}`, question: "What routes trigger export?", evidence: { path: "docs/routes.md", text: "POST /export triggers worker" }, expected: "APPLICABLE" },
    { id: `ea-${n++}`, question: "What routes trigger export?", evidence: { path: "worker/export.ts", text: "Cron handles export batch" }, expected: "NOT_APPLICABLE", note: "worker behavior not route doc" },
    { id: `ea-${n++}`, question: "What is nightly schedule?", evidence: { path: "README.md", text: "Exports run per merchant on a nightly schedule" }, expected: "APPLICABLE" },
    { id: `ea-${n++}`, question: "What is nightly schedule?", evidence: { path: "external/weather.txt", text: WEATHER }, expected: "NOT_APPLICABLE" },
  ];
  return [...out, ...extras];
}

/** @type {Array<{id:string,question:string,topEvidence:Array<{path:string,text:string,score:number}>,expected:"ANSWER_WITH_CURRENT_PIPELINE"|"ESCALATE"|"SILENT",note?:string}>} */
const ESCALATION = [
  {
    id: "ex-001",
    question: "Why does that retry three times?",
    topEvidence: [{ path: "src/exporter/retry.ts", text: RETRY_DOC, score: 6 }],
    expected: "ANSWER_WITH_CURRENT_PIPELINE",
  },
  {
    id: "ex-002",
    question: "What is the weather in Paris?",
    topEvidence: [{ path: "README.md", text: README, score: 1 }],
    expected: "SILENT",
  },
  {
    id: "ex-003",
    question: "What is Zylorp billing code?",
    topEvidence: [{ path: "README.md", text: README, score: 2 }],
    expected: "SILENT",
  },
  {
    id: "ex-004",
    question: "What does auth do and how are retries capped?",
    topEvidence: [
      { path: "src/auth.ts", text: AUTH_DOC, score: 5 },
      { path: "src/exporter/retry.ts", text: RETRY_DOC, score: 4 },
    ],
    expected: "ESCALATE",
    note: "multi-source",
  },
  {
    id: "ex-005",
    question: "What does the auth service do?",
    topEvidence: [{ path: "src/auth.ts", text: AUTH_DOC, score: 5 }],
    expected: "ANSWER_WITH_CURRENT_PIPELINE",
  },
];

function expandEscalation(base) {
  const out = [...base];
  let n = 6;
  const patterns = [
    { q: "Where is retry.ts?", ev: [{ path: "src/exporter/retry.ts", text: RETRY_DOC, score: 5 }], exp: "ANSWER_WITH_CURRENT_PIPELINE" },
    { q: "Capital of France?", ev: [{ path: "README.md", text: README, score: 0 }], exp: "SILENT" },
    { q: "Who owns auth and exporter?", ev: [{ path: "README.md", text: README, score: 3 }, { path: "src/auth.ts", text: AUTH_DOC, score: 3 }], exp: "ESCALATE" },
    { q: "Thanks everyone", ev: [{ path: "README.md", text: README, score: 1 }], exp: "SILENT" },
    { q: "Why three retries?", ev: [{ path: "src/exporter/retry.ts", text: RETRY_DOC, score: 4 }], exp: "ANSWER_WITH_CURRENT_PIPELINE" },
    { q: "Enterprise price?", ev: [{ path: "docs/pricing.md", text: PRICING_DOC, score: 5 }], exp: "ANSWER_WITH_CURRENT_PIPELINE" },
    { q: "Enterprise price?", ev: [{ path: "README.md", text: README, score: 1 }], exp: "SILENT" },
    { q: "SLA uptime?", ev: [{ path: "docs/sla.md", text: SLA_DOC, score: 5 }], exp: "ANSWER_WITH_CURRENT_PIPELINE" },
    { q: "SLA uptime?", ev: [{ path: "tests/sla.test.ts", text: "expect(uptime).toBe(1)", score: 2 }], exp: "ESCALATE", note: "test file vs doc" },
    { q: "Route docs vs worker?", ev: [{ path: "docs/routes.md", text: "POST /export triggers worker", score: 3 }, { path: "worker/export.ts", text: "Cron handles export batch", score: 3 }], exp: "ESCALATE", note: "contradictory" },
  ];
  for (let i = 0; i < 9; i++) {
    for (const p of patterns) {
      out.push({
        id: `ex-${String(n++).padStart(3, "0")}`,
        question: p.q,
        topEvidence: p.ev,
        expected: p.exp,
      });
    }
  }
  return out;
}

const applicability = expandApplicability(EVIDENCE_APPLICABILITY, 11);
const escalation = expandEscalation(ESCALATION);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({
  version: 1,
  description: "Offline truth-judge eval fixtures — synthetic only, no customer/beta data",
  counts: {
    question_classification: QUESTION_CLASSIFICATION.length,
    evidence_applicability: applicability.length,
    escalation: escalation.length,
    total: QUESTION_CLASSIFICATION.length + applicability.length + escalation.length,
  },
  tasks: ["question_classification", "evidence_applicability", "escalation"],
}, null, 2));

writeFileSync(join(outDir, "question-classification.json"), JSON.stringify(QUESTION_CLASSIFICATION, null, 2));
writeFileSync(join(outDir, "evidence-applicability.json"), JSON.stringify(applicability, null, 2));
writeFileSync(join(outDir, "escalation.json"), JSON.stringify(escalation, null, 2));

console.log(`Wrote ${QUESTION_CLASSIFICATION.length + applicability.length + escalation.length} labelled cases to ${outDir}`);
