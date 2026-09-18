# MeetHint — World-Class Gap Analysis

**Branch:** `feat/truth-layer-retrieval`
**Base:** `main` @ `0fc0740` (enterprise redesign merged)
**Date:** 2026-09-18
**Author:** Founding Product + Engineering analysis

This is the internal assessment required before changing code. It is derived
from reading the implementation (`src/lib/search/*`, `src/lib/listen/*`,
`src/lib/context/*`, `src/lib/security/*`, `src/lib/store.ts`, cockpit and
context components) and running the existing eval harnesses — not from the docs,
which are treated as claims to verify.

---

## 1. Current architecture

```
Live audio (getDisplayMedia + mic)
   → VAD (Silero) → utterance admission → local ASR (Whisper worker)
   → cleanCaption → question gate (gate-newest)
   → normalizeSpokenQuestion → shapeOf (intent)
   → retrieveHits (scope-filtered, hybrid lexical+semantic+structural)
   → routeSearchAnswer
        1. fail-fast on empty/weak retrieval (no LLM)
        2. localCard fast-path (verified, skips LLM)
        3. grounded LLM (generateAnswer)
        4. cited synthesis LLM (synthesizeAnswer)
        5. localCard fallback — never general knowledge
   → Card { say, citations, evidence, reason }
```

Storage is local-first: per-account IndexedDB (`meethint.<userId>`,
`meethint-vectors.<userId>`), server Postgres holds only Better Auth tables.
Tenant isolation is enforced by `retrieveHits(scope)` dropping foreign chunks
before ranking, plus per-account vault binding to a server-verified `userId`.

**Verified strengths of this design:** the cite-or-silence contract is real and
tested; the answer path is tiered so deterministic/local answers bypass paid
LLM calls; the subject-admission layer (`subject.ts`) already closes the
"directory name answers the question" defect class.

## 2. Current product strengths

- **Cite-or-silence is genuine.** `evidenceFitsShape` + `admissible` +
  `verifyEvidenceSpan` mean a well-cited docstring still gets rejected if it
  answers the wrong *shape* of question. This is the moat.
- **Subject admission is sophisticated.** `subjectTerms` uses relative document
  frequency, not a stopword list, so "service" is generic in a service-heavy
  repo and specific elsewhere.
- **Tiered answer routing** (`answer-route.ts`) already optimizes cost/latency:
  fail-fast → local fast-path → grounded → synthesis → local fallback.
- **Security posture is real.** Deterministic tenant-isolation tests plus a
  DeepTeam adversarial harness; corpus never leaves the browser by default.
- **Local-first** gives privacy + offline + speed — a strategic differentiator.

## 3. Critical weaknesses

- **Test-file citation bias (CONFIRMED BUG).** When a real service file is
  absent or under-documented, a test file whose docstring mentions the subject
  becomes the top hit and is spoken confidently. Reproduced:
  *"What does the shared BDA service do?"* → cites
  `tests/unit/test_shared_bda_service.py` ("Covers cache reuse…") — what the
  *test* covers, not what the *service* does. `retrieve()` has **no** test-path
  demotion; `isTestPath` exists in `repo/folder.ts` but is only used at ingest.
- **Router-docstring shallowness.** "What happens after upload?" can stop at an
  `api/routes/*` docstring describing the HTTP surface instead of reaching the
  worker/pipeline that performs the behavior. Behavior questions should prefer
  `services/`, `workers/`, `container-lambdas/` over route handlers.
- **No source-authority model.** All files rank on lexical/semantic/structural
  signal; a test file, a README, and a signed contract are peers. (This is the
  planned Truth Assessment Layer — correctly deferred, but the *ingest-time*
  authority signal is cheap and missing.)

## 4. Beta blockers

- The two retrieval bugs above directly produce **unsupported confident
  answers** — the #1 Wave-1 scorecard risk metric. Must fix before inviting.
- Otherwise the beta path (sign in → space → source → ask → live → feedback) is
  implemented and gated by `npm run beta:gates`.

## 5. Reliability risks

- **Hydration / reload-loop** fixes landed recently (`fix/waitlist-hydration`);
  production verification is pending deploy. Watch post-deploy.
- **E2E flakes** noted in the redesign report (claim-audit, audio-path).
- Live audio depends on `getDisplayMedia` + Silero + Whisper — many failure
  edges; failure states exist (`product-states.ts`) but need UX verification.

## 6. Security risks

- Well-mitigated: cross-tenant retrieval, embedding-cache bleed, client-forged
  user id. Deterministic + adversarial harnesses exist.
- Open: team/shared workspaces are Phase 1 (not built); auth defaults off in
  dev (`dev-user` shared vault) — must be on in production.

## 7. Retrieval weaknesses

- No test/fixture demotion at query time (the confirmed bug).
- No behavior-vs-endpoint distinction (router vs service).
- No source-authority / freshness / applicability signals (Truth Assessment).
- Reranking is deterministic; no learned reranker (correctly deferred — measure
  first).

## 8. UX weaknesses

- Silence reasons are generic (`silentCardReason`: "Your material doesn't cover
  this"). `shapeGap` produces good shape-specific text but the routing layer
  discards it in favor of a generic string — **easy trust win available**.
- No "all my documents" hub (logged as known Wave-1 friction).
- Cockpit density optimized for function; modal stacking bug fixed via portals
  (stashed, separate PR).

## 9. Performance opportunities

- localCard fast-path already bypasses LLM on high-confidence verified answers.
- Fail-fast avoids LLM on empty retrieval.
- p95 target < 2s; representative fixture ~816ms. Anticipatory retrieval is the
  big future lever but is P3 — do not build before beta evidence.

## 10. Highest-moat opportunities (in priority order)

1. **Cite-or-silence trust architecture** — already built; *protect it*.
2. **Sub-2s cited live answers** — mostly built; tighten.
3. **Source authority + freshness + contradiction** (Truth Assessment Layer) —
   the real differentiator vs. generic enterprise search. P2, after beta.
4. **Real Git/PR/commit reasoning** — built only on the demo pack today.
5. **Customer-commitment intelligence** — P4.

## 11. Things that should NOT be built yet

- Truth Assessment Layer full engine (P2 — needs beta evidence first).
- Anticipatory retrieval (P3 — measure first).
- Source connectors beyond GitHub/documents (GitHub + docs must be excellent
  first).
- Meeting Prep / Guardian / organizational memory (P5).
- Team workspaces, SSO, billing, analytics dashboards.
- Any learned reranker or general-knowledge fallback (would weaken the moat).

## 12. Recommended implementation order (this branch)

**P0 — protect the core (do now):**
1. Test-file demotion in `retrieve()` scoring + `bestClaim()` admission.
2. Behavior-over-router preference for "what/how/after" questions.
3. Regression tests pinning both (wrong-source holdout).

**P1 — trust UX (do now, cheap):**
4. Surface `shapeGap`/specific silence reasons instead of the generic string.

**Defer:** Truth Assessment, anticipatory retrieval, connectors, Git history on
user folders, Prep/Guardian. Revisit with Wave-1 scorecard data.

---

## What already works / partial / unfinished / duplicated / fragile / unnecessary

- **Works extremely well:** cite-or-silence admission, subject-terms, tiered
  routing, tenant isolation, local-first storage.
- **Partially implemented:** Git intelligence (demo pack only), source metadata
  (ingest-time `scorePath` only), silence reasons (exist but not surfaced).
- **Unfinished:** Truth Assessment, connectors, team workspaces, Prep/Guardian.
- **Duplicated:** test-path logic exists in `repo/folder.ts` (ingest) but not in
  `search/retrieve.ts` (query) — the gap this branch closes.
- **Fragile:** live audio pipeline edges; hydration on extension-heavy browsers.
- **Unnecessary (do not add):** general-knowledge fallback, learned reranker,
  analytics dashboard, fake enterprise claims.

## What prevents indispensability

A single confident wrong answer in a live customer call destroys the category
claim. The test-file bug is exactly that. Fixing it is the highest-leverage
work in the repo right now.

## What creates the moat

Verified, cited, sub-2-second answers that a Sales Engineer will say out loud
to a Fortune 500 customer — and *correct silence* when the company doesn't
know. Everything else compounds from that trust.
