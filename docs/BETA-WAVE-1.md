# Beta Wave 1 — Operations (#115)

**Wave:** 1  
**Target testers:** 5 external technical users  
**Observation window:** 3–5 days before considering Wave 2 (#116)  
**Start date:** _TBD_  
**Owner:** _TBD_

## Goal

Invite five real users, observe product behavior in the wild, and collect evidence — not build new features during the wave.

## How to fill this scorecard

1. Tester signs up on production (`https://www.meethint.ai`).
2. After 24–48h (or on exit), ask them to export diagnostics from Live cockpit → **Diagnostics** (privacy-safe JSON).
3. Open the diagnostic JSON and copy metrics from the export (no server upload required):

   - `timings.timeToFirstUsefulAnswerMs`
   - `timings.latencyP95`
   - `qualitySummary` (supported/silence/useful rates)
   - Event timestamps in `betaTelemetry.records` (`SIGNUP`, `SOURCE_CONNECTED`, `FIRST_LIVE_SESSION`, `RETURN_DAY_1`, `RETURN_DAY_7`)

   Optional local sanity check with a flight fixture: `npm run beta:quality-report -- --flight fixtures/flight-sessions/real-session-latest.json`

4. Record qualitative fields (frustration, WTP, notes) from a 15-minute debrief or async form.
5. Update this table daily during the observation window.

### Metric sources (in-product telemetry)

| Column | Source |
|--------|--------|
| Signup date | `USER_CREATED` / `SIGNUP` event timestamp |
| Source connected | `SOURCE_CONNECTED` (Y/N + date) |
| First useful answer time | `summarizeBetaFunnel().timeToFirstUsefulAnswerMs` |
| Live session used | `FIRST_LIVE_SESSION` (Y/N) |
| Useful answer rate | useful feedback ÷ supported answers |
| Unsupported confident answer count | Manual review: supported answers that should have been silent (from 👎 + flight review) |
| Citation opens | Manual count from session / ask for now (no dedicated event yet) |
| p95 latency | `beta:quality-report` → `latencyP95` |
| D1 / D7 return | `RETURN_DAY_1` / `RETURN_DAY_7` events |

## Tester scorecard

| Field | W1-01 | W1-02 | W1-03 | W1-04 | W1-05 |
|-------|-------|-------|-------|-------|-------|
| **Tester ID / name** | _invite pending_ | _invite pending_ | _invite pending_ | _invite pending_ | _invite pending_ |
| **Persona** | _e.g. staff engineer, uses Zoom daily_ | | | | |
| **Signup date** | | | | | |
| **Source connected** | | | | | |
| **First useful answer time** | | | | | |
| **Live session used** | | | | | |
| **Useful answer rate** | | | | | |
| **Unsupported confident answer count** | | | | | |
| **Citation opens** | | | | | |
| **p95 latency (ms)** | | | | | |
| **D1 return** | | | | | |
| **D7 return** | | | | | |
| **Biggest frustration** | | | | | |
| **Willingness to pay** | | | | | |
| **Notes** | | | | | |

## Invite checklist (per tester)

- [ ] Send [BETA-TESTER-INSTRUCTIONS.md](./BETA-TESTER-INSTRUCTIONS.md)
- [ ] Confirm they can sign in on production
- [ ] Confirm account is isolated (they only see their own Knowledge Spaces)
- [ ] Schedule debrief within 5 days of signup
- [ ] Collect diagnostic export (or walk through export together)
- [ ] Log issues in triage doc using [BETA-ISSUE-TRIAGE.md](./BETA-ISSUE-TRIAGE.md)

## Wave 1 go / no-go (after 3–5 days)

Proceed to Wave 2 (#116) only if **none** of these appear:

- Auth or session breakage
- Cross-account data leakage
- Persistence loss after refresh or browser restart
- Onboarding blocker (cannot connect source or ask first question)
- Pattern of unsupported confident answers (wrong + cited)

## Known friction to watch (no fix during Wave 1)

Track in **Notes** / **Biggest frustration** — do not ship UI changes mid-wave:

- **Document inventory:** testers may ask for one obvious place to see everything they uploaded and jump to all documents. Today, files appear in the Knowledge Space context panel; there is no dedicated “all my documents” hub. Log as MEDIUM UX if reported.

## Related docs

- [BETA-TESTER-INSTRUCTIONS.md](./BETA-TESTER-INSTRUCTIONS.md) — send to testers
- [BETA-ISSUE-TRIAGE.md](./BETA-ISSUE-TRIAGE.md) — severity rubric
- [BETA-MILESTONE-REPORT.md](./BETA-MILESTONE-REPORT.md) — instrumentation reference
- [PRODUCT-BACKLOG.md](./PRODUCT-BACKLOG.md) — #115, #116, #117
