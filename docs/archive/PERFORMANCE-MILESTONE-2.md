# Milestone 2 — Performance optimization (complete)

**Status:** Complete as of 2026-09-14 (Steps 5A–5D).

**Product target:** p95 first supported answer under ~2 seconds.

## Final measured baseline (50-trace production capture, GPT-4o Mini)

Validated after Step 5C (localCard fast-path) and Step 5D (semantic quality validation).

| Metric | Value |
|--------|-------|
| Supported total **p50** | ~1 ms |
| Supported total **p95** | ~816 ms |
| Supported total **p99** | ~1603 ms |
| Supported rate | 28 / 50 |
| Fast-path LLM bypasses | 24 / 50 |
| Fast-path semantic acceptance | **100%** |
| Conflicting fast-path answers | **0** |
| Incomplete fast-path answers | **0** |

Retrieval p95 remains ~1 ms. Remaining latency is dominated by **3 grounded traces** (~550–816 ms each) where localCard cannot compose a verified answer and the LLM path is required.

## What shipped

| Step | Outcome |
|------|---------|
| 5A | Real-time latency instrumentation (`answer-latency`, flight recorder stages) |
| 5B / 5B.1 | Capture harness, 50-scenario production traces, progressive agreement analysis |
| 5C | Verified localCard fast-path (skip unnecessary grounded/synthesis LLM), fail-fast weak retrieval, prompt trim |
| 5D | Fast-path semantic quality validation vs 5B.1 baseline; grounded trace + streaming observation |

## Explicitly deferred (evidence does not justify yet)

| Optimization | Why deferred |
|--------------|--------------|
| **Source routing** | Retrieval p95 ~1 ms; routing would add complexity without measurable latency win on captured data |
| **Anticipatory retrieval** | Retrieval cost does not scale materially with source count in capture set |
| **Progressive answer replacement** | Shadow localCard vs final LLM agreement **61.1%** on comparable traces (< 85% safety threshold) |
| **Model swapping** | Dominant win was eliminating unnecessary LLM calls; remaining 3 grounded traces are model-latency-bound with tiny prompts (~97–137 tokens) |

## Validation tooling

```bash
node scripts/flight-validate-5d.mjs          # fast-path semantic comparison vs baseline fixture
node scripts/flight-grounded-5d.mjs          # remaining grounded diagnostics + streaming (requires .env LLM key)
npm test                                      # includes fast-path-quality.test.ts
```

Fixtures: `fixtures/flight-sessions/real-session-baseline-5b1.json` (pre-5C), `real-session-latest.json` (post-5C).

## Next roadmap focus

Shift from architecture/perf to product usage:

1. Closed Beta
2. Answer Feedback (flight feedback → product loop)
3. Retention analytics
4. Real meetings with design partners
