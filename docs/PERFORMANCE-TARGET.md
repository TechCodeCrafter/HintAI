# Live answer latency target

**Product target:** p95 first supported answer under **~2 seconds** for common questions in a typical Knowledge Space (1–4 repos, indexed, live session).

## Measured baseline (Milestone 2 complete — 2026-09-14)

50-trace production capture after Step 5C fast-path optimization:

| Metric | Value |
|--------|-------|
| Supported total p50 | ~1 ms |
| Supported total p95 | ~816 ms |
| Supported total p99 | ~1603 ms |
| Fast-path semantic acceptance | 100% (0 conflicting, 0 incomplete) |

See [PERFORMANCE-MILESTONE-2.md](./PERFORMANCE-MILESTONE-2.md) for deferred optimizations and validation commands.

This is a measurement baseline — not a CI gate and not a fake pass/fail test.

Use:

```bash
DEBUG_FLIGHT=true npm run dev          # record per-answer traces in local vault
npm run flight:summary session.json    # p50/p95/p99 by stage
npm run flight:analyze session.json    # tier breakdown + recommendations
npm run latency:benchmark              # local representative fixtures
node scripts/flight-validate-5d.mjs    # Step 5D fast-path quality vs baseline fixture
```

Optimize only after reviewing measured stage breakdowns (retrieval vs synthesis vs verification vs hydration).
