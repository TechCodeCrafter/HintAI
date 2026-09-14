# Live answer latency target

**Product target:** p95 first supported answer under **~2 seconds** for common questions in a typical Knowledge Space (1–4 repos, indexed, live session).

This is a measurement baseline for Step 5A instrumentation — not a CI gate and not a fake pass/fail test.

Use:

```bash
DEBUG_FLIGHT=true npm run dev          # record per-answer traces in local vault
npm run flight:summary session.json    # p50/p95/p99 by stage
npm run latency:benchmark              # local representative fixtures
```

Optimize only after reviewing measured stage breakdowns (retrieval vs synthesis vs verification vs hydration).
