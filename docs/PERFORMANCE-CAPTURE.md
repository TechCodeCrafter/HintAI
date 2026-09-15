# Step 5B — Real-session performance capture

Observation only. No routing, prefetch, or model changes during capture.

## Enable capture

```bash
DEBUG_FLIGHT=true npm run dev
# or VITE_DEBUG_FLIGHT=true for Vite dev
```

Download the flight log from the cockpit debug control, or read from account-scoped localStorage key `meethint.flightLog`.

## Privacy policy (enforced)

Captured fields:

- `traceId`, `workspaceId`, `spaceId`, `sourceIds[]`
- answer tier, stage timings, hit/evidence counts
- supported/silent status, fallback reason
- model id / provider / display name (no API keys, no prompts)
- transcript summary (counts + capped last question — not full lanes)
- progressive timing (shadow localCard observation)

Never captured: raw file bodies, chunk text, evidence bodies, embeddings, API keys, prompts.

## Manual test plan

Run each scenario at least **5×**; aim for capture goals below.

| # | Scenario | Knowledge Space setup | Example question | Expected tier |
|---|----------|----------------------|------------------|---------------|
| 1 | Single-repo factual | 1 indexed repo (NORTHSTAR or your repo) | "Why does that retry three times?" | localCard |
| 2 | Multi-repo | 2–4 repos in one space | Question needing auth + billing repos | grounded / synthesis |
| 3 | Repo + PDF | 1 repo + 1 indexed PDF | Question spanning code + PDF | synthesis |
| 4 | Requires synthesis | Material where localCard fails | Cross-source "how" question | grounded / synthesis |
| 5 | Should stay silent | Any space | Off-topic ("weather in Tokyo") | silent |
| 6 | Rephrased / repeat | Same space as #1 | Same question rephrased live | localCard |

Optional: set `window.__groundFlight.captureScenario = "multi-repo-synthesis"` before asking (future UI hook) — or tag mentally and filter in analysis.

## Capture goals (meaningful p95)

| Bucket | Target samples |
|--------|----------------|
| localCard supported | ≥ 30 |
| grounded + synthesis | ≥ 30 |
| multi-source (sourceCount > 1) | ≥ 20 |

## Analyze

```bash
npm run flight:summary path/to/flight-export.json
npm run flight:analyze path/to/flight-export.json
npm run flight:analyze -- --synthetic   # validation dataset only
```

## Step 5D — Fast-path quality validation

Compare post-5C captures against the 5B.1 baseline fixture (no answer bodies in telemetry):

```bash
node scripts/flight-validate-5d.mjs
node scripts/flight-grounded-5d.mjs     # requires OPENAI_API_KEY in .env
```

Unit tests: `src/lib/instrumentation/__tests__/fast-path-quality.test.ts`

## Decision thresholds

See `OPTIMIZATION_THRESHOLDS` in `src/lib/instrumentation/flight-analysis.ts`:

- Retrieval p95 < **100 ms** → do not prioritize source routing for latency
- Total supported p95 < **2000 ms** → avoid unnecessary architecture changes
- LLM p95 dominates → model/prompt/progressive rendering before routing
- Verification p95 > **150 ms** → profile evidence verification
- Progressive save p95 > **300 ms** → consider progressive rendering (5C)
