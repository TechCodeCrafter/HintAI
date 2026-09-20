# Closed beta feedback & quality instrumentation

Milestone: make Hint safe, measurable, and simple enough for 10–20 external beta users in real meetings.

## Beta onboarding flow

1. **Sign in** — account vault binds via `BetaTelemetryBoot` (`USER_CREATED` / `SIGNUP`).
2. **Create/open Knowledge Space** — `/create` wizard or home list (`SPACE_CREATED`).
3. **Add repo/folder/PDF** — create flow or context detail (`SOURCE_CONNECTED`).
4. **Wait for indexing** — status shown via `ProductStateAlert` + `BetaSearchScopeNote` (`INDEX_READY`).
5. **Ask a test question** — `/context/$id/ask` (`FIRST_QUESTION` / `FIRST_ASK`).
6. **Start Live** — `/context/$id/live` (`FIRST_LIVE_SESSION`).

UI: `BetaOnboardingChecklist` on home, scope notes on Ask/Live, dismissible `BetaPrivacyNotice`.

## Analytics events

Account-scoped local JSONL (`meethint.betaTelemetry`):

| Event | When |
|-------|------|
| `USER_CREATED` / `SIGNUP` | Vault ready |
| `SPACE_CREATED` | Knowledge Space created |
| `SOURCE_CONNECTED` | Folder/PDF indexed |
| `INDEX_READY` | First successful index |
| `FIRST_QUESTION` / `FIRST_ASK` | First search |
| `SUPPORTED_ANSWER` / `SILENT_ANSWER` | Answer routed |
| `ANSWER_MARKED_USEFUL` | Thumbs up |
| `NEGATIVE_FEEDBACK` | Thumbs down + category |
| `FIRST_LIVE_SESSION` | Live cockpit opened |
| `SESSION_START` | App session |
| `RETURN_DAY_1` / `RETURN_DAY_7` | Return visits |

**Time to First Useful Answer** = `USER_CREATED` → `ANSWER_MARKED_USEFUL` (see `summarizeBetaFunnel()`).

## Feedback schema

```typescript
{
  kind: "feedback",
  traceId, answerId,
  workspaceId, spaceId,
  sourceIds: string[],
  tier, latencyMs,
  result: "useful" | "not-useful",
  failureCategory?: // when not-useful
    "wrong-answer" | "missing-context" | "wrong-source" |
    "citation-incorrect" | "too-vague" | "too-slow" |
    "should-have-stayed-silent" | "other"
}
```

In-product: 👍 Useful, 👎 Not useful → reason picker. Shown on **supported answers only** (Ask + Live).

No source bodies, evidence text, API keys, or full transcripts in telemetry.

## Quality report output

```bash
npm run beta:quality-report
npm run beta:quality-report -- --flight fixtures/flight-sessions/real-session-latest.json
```

Reports: supported/silence/useful rates, negative reason breakdown, p50/p95 latency, tier mix, average sources cited, multi-source rate, funnel timestamps, lifecycle counts.

## Diagnostic export contents

Live cockpit **Diagnostics** button → JSON download:

- App version, browser/platform
- Trace IDs (recent answers/feedback)
- Timings (p50/p95, TTFA)
- Source counts/types
- Error codes from failed indexing events
- Privacy-safe beta telemetry bundle
- Flight session (only when `DEBUG_FLIGHT` enabled)

**Excluded:** file contents, API keys, full transcripts, evidence bodies.

## Product error states

`src/lib/product-states.ts` — plain-language alerts for indexing, no knowledge, unsupported answer, provider failure, missing API key, microphone unavailable, source index failure, session not authenticated.

## Beta gates

```bash
npm run beta:gates
```

Automated checks: full test suite, typecheck, representative capture p95 &lt; 2s.

Manual before external beta: `npm run test:e2e` (account-isolation, knowledge-space).

## Test results (this branch)

| Check | Result |
|-------|--------|
| `npm test` | pass |
| `npm run typecheck` | pass |
| `beta-telemetry.test.ts` | pass |
| `product-states.test.ts` | pass |
| Representative p95 (fixture) | ~816 ms (&lt; 2000 ms target) |

## Remaining launch blockers

- ~~Run E2E account-isolation + knowledge-space on CI before inviting external users.~~ **Cleared 2026-09-18** — `account-isolation`, `knowledge-space`, and `private-workspace` specs all pass (4/4) against `main` @ `2cbf2d8` (truth-layer retrieval merged).
- Collect real beta telemetry from 10–20 users (local export aggregation process TBD).
- Optional: server-side aggregation endpoint (out of scope — local-first only shipped).

## Out of scope (not implemented)

Jira, Slack, Confluence, MCP, source routing, anticipatory retrieval, enterprise SSO, billing, major homepage redesign.
