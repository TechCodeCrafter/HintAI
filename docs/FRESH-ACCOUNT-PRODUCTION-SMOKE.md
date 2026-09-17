# Fresh Account Production Smoke (#110)

**Recorded:** 2026-09-16T23:58:48Z
**Run ID:** 9861c9a1-7843-4fdd-8979-67e7fb492d8a
**URL:** https://www.meethint.ai
**Browser / profile:** Playwright Desktop Chrome — Chrome persistent profile (.grok/smoke-profile-{a|b})
**Account type:** Google OAuth production account
**Auth A/B verify:** PASS
**Authenticated smoke executed:** yes

## Result: ✅ PASS

### Step results

| Step | Result |
| --- | --- |
| auth-session | PASS |
| api-key-injected | PASS |
| index-ready | PASS |
| space-created | PASS |
| supported-ask | PASS |
| citation-open | PASS |
| feedback-useful | PASS |
| unsupported-ask | PASS |
| live-start | PASS |
| live-questions | PASS |
| feedback-not-useful | PASS |
| diagnostics-privacy | PASS |
| refresh-session | PASS |
| same-user-persistence | PASS |
| cross-user-isolation | PASS |

### Timings

| Metric | Value |
| --- | --- |
| login time | 983 ms |
| index ready | 863 ms |
| time to first useful answer | 123 ms |
| supported answers | 5 |
| unsupported confident (bad) | 0 |
| live p50 | 17 ms |
| live p95 | 33 ms |

### Issues

None.

### How to run

```bash
node scripts/capture-smoke-auth.mjs a
node scripts/capture-smoke-auth.mjs b --fresh   # different Google smoke account than A
export MEETHINT_SMOKE_OPENAI_API_KEY="sk-..."
node scripts/run-production-smoke.mjs
```

**Ticket #110:** ✅ COMPLETE
**Next:** #115 Beta Wave 1
