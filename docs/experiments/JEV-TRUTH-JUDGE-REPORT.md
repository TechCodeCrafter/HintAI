# Jev Truth Judge — Benchmark Report

_Generated: 2026-09-22T13:54:56.358Z_

> **Jev is disabled** pending TypeSafe early access. Eval runs deterministic + LLM only unless `JEV_ENABLED=1` and a key are set.

## Recommendation

**CONTINUE EXPERIMENT — Jev disabled pending TypeSafe early access (deterministic + LLM baseline only)**

Feature flag candidate only if unsafe continuation materially below 41.25% baseline, safe coverage useful, acceptable p95/cost/privacy. No production merge in this milestone.

## Jev status

Jev disabled — set `JEV_ENABLED=1` when TypeSafe early access is available

_Jev is opt-in only. No Jev results were fabricated._

## Jev API verification

| Field | Value |
|-------|-------|
| Endpoint | `https://api.typesafe.ai/v1/systemone` |
| Auth | Authorization: Bearer <JEV_API_KEY or TYPESAFE_API_KEY> |
| Batching | Multiple questions in one POST supported |
| Rate limits (documented) | ~1200 req/min, 250k tokens/sec (TypeSafe docs, Sep 2026) |
| Live probe | "SKIPPED — Jev disabled — set JEV_ENABLED=1 when TypeSafe early access is available" |

## Decision table

| Judge | Applicability accuracy | Unsafe continuation | Safe coverage | p95 (ms) | Cost/1k |
|-------|------------------------|--------------------|--------------|---------|---------|
| Deterministic | 56.25% | 41.25% | 47.50% | 0 | — |
| LLM | 93.75% | 5.00% | 48.75% | 1042 | — |

## deterministic

### A. Question classification

- Accuracy: 80.00%
- Macro precision: 83.03%
- Macro recall: 82.87%
- Confusion matrix:

  - `architecture` → {"architecture":4,"product_capability":0,"security_compliance":0,"implementation":0,"general_technical_reasoning":0,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":0}
  - `product_capability` → {"architecture":0,"product_capability":2,"security_compliance":2,"implementation":0,"general_technical_reasoning":0,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":0}
  - `security_compliance` → {"architecture":0,"product_capability":0,"security_compliance":5,"implementation":1,"general_technical_reasoning":0,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":0}
  - `implementation` → {"architecture":0,"product_capability":0,"security_compliance":1,"implementation":5,"general_technical_reasoning":1,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":1}
  - `general_technical_reasoning` → {"architecture":0,"product_capability":0,"security_compliance":0,"implementation":0,"general_technical_reasoning":4,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":0}
  - `contractual_sla` → {"architecture":0,"product_capability":0,"security_compliance":0,"implementation":0,"general_technical_reasoning":0,"contractual_sla":3,"pricing_packaging":0,"current_external_fact":0,"other":1}
  - `pricing_packaging` → {"architecture":0,"product_capability":0,"security_compliance":0,"implementation":1,"general_technical_reasoning":0,"contractual_sla":0,"pricing_packaging":3,"current_external_fact":0,"other":0}
  - `current_external_fact` → {"architecture":0,"product_capability":0,"security_compliance":0,"implementation":0,"general_technical_reasoning":0,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":5,"other":0}
  - `other` → {"architecture":0,"product_capability":0,"security_compliance":0,"implementation":0,"general_technical_reasoning":0,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":1}
- Latency p50/p95/p99: 0/0/0 ms (n=40)

### B. Evidence applicability

- Accuracy: 56.25%
- Precision: 53.52%
- Recall: 95.00%
- False applicable (unsafe): 33
- False not-applicable: 2
- **Unsafe continuation: 41.25%** (33/80)
- Safe coverage: 47.50%
- Refusal rate: 11.25%

| Threshold | Unsafe | Correct continue | False silence | Coverage | Silence |
|-----------|--------|------------------|---------------|----------|---------|
| 0.5 | 41.25% | 47.50% | 2.50% | 88.75% | 11.25% |
| 0.6 | 41.25% | 47.50% | 2.50% | 88.75% | 11.25% |
| 0.7 | 41.25% | 47.50% | 2.50% | 88.75% | 11.25% |
| 0.8 | 41.25% | 47.50% | 2.50% | 88.75% | 11.25% |
| 0.9 | 0.00% | 0.00% | 50.00% | 0.00% | 100.00% |
| 0.95 | 0.00% | 0.00% | 50.00% | 0.00% | 100.00% |
| 0.98 | 0.00% | 0.00% | 50.00% | 0.00% | 100.00% |
- Latency p50/p95/p99: 0/0/3 ms (n=80)

### C. Escalation

- Accuracy: 89.47%
- ANSWER precision: 96.67%
- ESCALATE rate: 37.89%
- SILENT rate: 30.53%
- Unsafe continuation: 0.00%
- Safe coverage: 58.95%
- Latency p50/p95/p99: 0/0/0 ms (n=95)

### Cost

- Measured total USD: n/a
- Est. per 1,000 questions: n/a
- Est. per 10,000 questions: n/a

## llm

### A. Question classification

- Accuracy: 62.50%
- Macro precision: 76.94%
- Macro recall: 68.24%
- Confusion matrix:

  - `architecture` → {"architecture":3,"product_capability":0,"implementation":0,"general_technical_reasoning":1,"security_compliance":0,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":0}
  - `product_capability` → {"architecture":0,"product_capability":2,"implementation":0,"general_technical_reasoning":0,"security_compliance":0,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":2}
  - `implementation` → {"architecture":0,"product_capability":0,"implementation":3,"general_technical_reasoning":0,"security_compliance":0,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":5}
  - `general_technical_reasoning` → {"architecture":0,"product_capability":0,"implementation":2,"general_technical_reasoning":1,"security_compliance":0,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":1}
  - `security_compliance` → {"architecture":0,"product_capability":0,"implementation":1,"general_technical_reasoning":1,"security_compliance":4,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":0}
  - `contractual_sla` → {"architecture":0,"product_capability":0,"implementation":0,"general_technical_reasoning":0,"security_compliance":0,"contractual_sla":4,"pricing_packaging":0,"current_external_fact":0,"other":0}
  - `pricing_packaging` → {"architecture":0,"product_capability":0,"implementation":0,"general_technical_reasoning":0,"security_compliance":0,"contractual_sla":0,"pricing_packaging":4,"current_external_fact":0,"other":0}
  - `current_external_fact` → {"architecture":0,"product_capability":0,"implementation":0,"general_technical_reasoning":0,"security_compliance":0,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":3,"other":2}
  - `other` → {"architecture":0,"product_capability":0,"implementation":0,"general_technical_reasoning":0,"security_compliance":0,"contractual_sla":0,"pricing_packaging":0,"current_external_fact":0,"other":1}
- Latency p50/p95/p99: 742/1176/1399 ms (n=40)

### B. Evidence applicability

- Accuracy: 93.75%
- Precision: 90.70%
- Recall: 97.50%
- False applicable (unsafe): 4
- False not-applicable: 1
- **Unsafe continuation: 5.00%** (4/80)
- Safe coverage: 48.75%
- Refusal rate: 46.25%

| Threshold | Unsafe | Correct continue | False silence | Coverage | Silence |
|-----------|--------|------------------|---------------|----------|---------|
| 0.5 | 16.25% | 48.75% | 1.25% | 65.00% | 35.00% |
| 0.6 | 16.25% | 48.75% | 1.25% | 65.00% | 35.00% |
| 0.7 | 16.25% | 48.75% | 1.25% | 65.00% | 35.00% |
| 0.8 | 15.00% | 47.50% | 2.50% | 62.50% | 37.50% |
| 0.9 | 7.50% | 47.50% | 2.50% | 55.00% | 45.00% |
| 0.95 | 2.50% | 5.00% | 45.00% | 7.50% | 92.50% |
| 0.98 | 2.50% | 3.75% | 46.25% | 6.25% | 93.75% |
- Latency p50/p95/p99: 738/1042/1304 ms (n=80)

### C. Escalation

- Accuracy: 67.37%
- ANSWER precision: 79.17%
- ESCALATE rate: 38.95%
- SILENT rate: 10.53%
- Unsafe continuation: 21.05%
- Safe coverage: 57.89%
- Latency p50/p95/p99: 693/1058/1349 ms (n=95)

### Cost

- Measured total USD: n/a
- Est. per 1,000 questions: n/a
- Est. per 10,000 questions: n/a
- LLM provider does not expose per-call cost in synthesis-client — not estimated

## Unsafe continuation cases (applicability)

### deterministic (33)

- **ea-008** — Q: What is enterprise pricing?
  - Evidence: src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-010** — Q: What uptime is guaranteed?
  - Evidence: tests/retry.test.ts: expect(retries).toBe(3)
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-012** — Q: How does cookie rotation work?
  - Evidence: src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-014** — Q: What happens on export failure?
  - Evidence: src/auth.ts: The auth service verifies the session cookie on every non-public request and rotates it on the way out.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-016** — Q: Where is settlement CSV built?
  - Evidence: external/weather.txt: The weather in Paris is sunny with mild winds.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-018** — Q: Is auth checked on every request?
  - Evidence: docs/pricing.md: Enterprise plan is billed annually at twelve hundred dollars per seat.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-020** — Q: What is the retry cap?
  - Evidence: src/demo.ts: export const token = 'demo';
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-022** — Q: What does Northstar export?
  - Evidence: docs/sla.md: We guarantee 99.9% uptime for export API availability per contract section 4.2.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-026** — Q: What is PAY-219?
  - Evidence: src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-028** — Q: How does cookie rotation work? (variant 2)
  - Evidence: src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-030** — Q: What happens on export failure? (variant 2)
  - Evidence: src/auth.ts: The auth service verifies the session cookie on every non-public request and rotates it on the way out.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-032** — Q: Where is settlement CSV built? (variant 2)
  - Evidence: external/weather.txt: The weather in Paris is sunny with mild winds.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-034** — Q: Is auth checked on every request? (variant 2)
  - Evidence: docs/pricing.md: Enterprise plan is billed annually at twelve hundred dollars per seat.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-036** — Q: What is the retry cap? (variant 2)
  - Evidence: src/demo.ts: export const token = 'demo';
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-038** — Q: What does Northstar export? (variant 2)
  - Evidence: docs/sla.md: We guarantee 99.9% uptime for export API availability per contract section 4.2.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-042** — Q: What is PAY-219? (variant 2)
  - Evidence: src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-044** — Q: How does cookie rotation work? (variant 3)
  - Evidence: src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-046** — Q: What happens on export failure? (variant 3)
  - Evidence: src/auth.ts: The auth service verifies the session cookie on every non-public request and rotates it on the way out.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-048** — Q: Where is settlement CSV built? (variant 3)
  - Evidence: external/weather.txt: The weather in Paris is sunny with mild winds.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-050** — Q: Is auth checked on every request? (variant 3)
  - Evidence: docs/pricing.md: Enterprise plan is billed annually at twelve hundred dollars per seat.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-052** — Q: What is the retry cap? (variant 3)
  - Evidence: src/demo.ts: export const token = 'demo';
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-054** — Q: What does Northstar export? (variant 3)
  - Evidence: docs/sla.md: We guarantee 99.9% uptime for export API availability per contract section 4.2.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-058** — Q: What is PAY-219? (variant 3)
  - Evidence: src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-60** — Q: Why does that retry three times?
  - Evidence: src/exporter/retry.ts: Attempts are not capped at three.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-62** — Q: What owns authentication?
  - Evidence: README.md: Settlement exports run nightly.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-63** — Q: What is Zylorp headquarters address?
  - Evidence: README.md: Northstar exports merchant settlement files to S3 and guards the operator dashboard with edge auth.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-66** — Q: What version is retry policy?
  - Evidence: src/exporter/retry.ts: Policy v3 caps attempts at three.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-68** — Q: Does README mention S3?
  - Evidence: README.md: guards the operator dashboard
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-70** — Q: What handles dead-letter replay?
  - Evidence: src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-72** — Q: Is session rotated on exit?
  - Evidence: src/exporter/retry.ts: on the way out
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-74** — Q: What is edge auth purpose?
  - Evidence: docs/pricing.md: Enterprise plan is billed annually at twelve hundred dollars per seat.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-78** — Q: What routes trigger export?
  - Evidence: worker/export.ts: Cron handles export batch
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)
- **ea-80** — Q: What is nightly schedule?
  - Evidence: external/weather.txt: The weather in Paris is sunny with mild winds.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.85)

### llm (4)

- **ea-022** — Q: What does Northstar export?
  - Evidence: docs/sla.md: We guarantee 99.9% uptime for export API availability per contract section 4.2.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.90)
- **ea-66** — Q: What version is retry policy?
  - Evidence: src/exporter/retry.ts: Policy v3 caps attempts at three.
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.90)
- **ea-76** — Q: How many export attempts?
  - Evidence: tests/retry.test.ts: toBe(3)
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.90)
- **ea-78** — Q: What routes trigger export?
  - Evidence: worker/export.ts: Cron handles export batch
  - Expected: NOT_APPLICABLE → Predicted: APPLICABLE (conf: 0.90)

## Failure analysis

### LLM FALSE POSITIVES

- **ea-022** (overlap heuristic / verifyClaim mismatch): What does Northstar export?
  - docs/sla.md: We guarantee 99.9% uptime for export API availability per contract section 4.2.
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.90
- **ea-66** (version mismatch): What version is retry policy?
  - src/exporter/retry.ts: Policy v3 caps attempts at three.
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.90
- **ea-76** (test assertion not doc): How many export attempts?
  - tests/retry.test.ts: toBe(3)
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.90
- **ea-78** (worker behavior not route doc): What routes trigger export?
  - worker/export.ts: Cron handles export batch
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.90

### LLM FALSE NEGATIVES

- **ea-003** (overlap heuristic / verifyClaim mismatch): What is the architecture?
  - README.md: Northstar exports merchant settlement files to S3 and guards the operator dashboard with edge auth.
  - expected APPLICABLE, got NOT_APPLICABLE, conf 0.80

### DETERMINISTIC FALSE POSITIVES

- **ea-008** (overlap heuristic / verifyClaim mismatch): What is enterprise pricing?
  - src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.85
- **ea-010** (test vs contract): What uptime is guaranteed?
  - tests/retry.test.ts: expect(retries).toBe(3)
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.85
- **ea-012** (overlap heuristic / verifyClaim mismatch): How does cookie rotation work?
  - src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.85
- **ea-014** (overlap heuristic / verifyClaim mismatch): What happens on export failure?
  - src/auth.ts: The auth service verifies the session cookie on every non-public request and rotates it on the way out.
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.85
- **ea-016** (overlap heuristic / verifyClaim mismatch): Where is settlement CSV built?
  - external/weather.txt: The weather in Paris is sunny with mild winds.
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.85
- **ea-018** (overlap heuristic / verifyClaim mismatch): Is auth checked on every request?
  - docs/pricing.md: Enterprise plan is billed annually at twelve hundred dollars per seat.
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.85
- **ea-020** (overlap heuristic / verifyClaim mismatch): What is the retry cap?
  - src/demo.ts: export const token = 'demo';
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.85
- **ea-022** (overlap heuristic / verifyClaim mismatch): What does Northstar export?
  - docs/sla.md: We guarantee 99.9% uptime for export API availability per contract section 4.2.
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.85
- **ea-026** (overlap heuristic / verifyClaim mismatch): What is PAY-219?
  - src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.85
- **ea-028** (overlap heuristic / verifyClaim mismatch): How does cookie rotation work? (variant 2)
  - src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - expected NOT_APPLICABLE, got APPLICABLE, conf 0.85

### DETERMINISTIC FALSE NEGATIVES

- **ea-006** (overlap heuristic / verifyClaim mismatch): Where is retry logic?
  - src/exporter/retry.ts: Attempts are capped at three because the payment gateway stalls rather than failing fast.
  - expected APPLICABLE, got NOT_APPLICABLE, conf 0.90
- **ea-64** (exact supported in wrong corpus item): What is Zylorp headquarters address?
  - external/zylorp.txt: 123 Main St
  - expected APPLICABLE, got NOT_APPLICABLE, conf 0.90

## Baseline reference

- Deterministic classification accuracy: 80%
- Applicability unsafe continuation: 41.25%
- Escalation unsafe continuation: 0%

See [JEV-EVALUATION.md](./JEV-EVALUATION.md) for privacy and kill criteria.
