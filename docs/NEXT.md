# Hint: What We Are Doing Now

**Last Updated:** 2026-09-20

Canonical backlog: [PRODUCT-BACKLOG.md](./PRODUCT-BACKLOG.md)

## Current Phase

Closed Beta Launch — trust/security hardening landed before Wave 1 invites.

## Recently completed

- **#174** Secure server synthesis endpoint — auth middleware, rate limits, size caps on `completeSynthesis`
- **#175** Deterministic claim verification — negation/numeric/phrase-order checks in `verifyClaim`
- **#176** Source authority weighting — test/example/snapshot demotion + docs/contracts boost
- **#106** Authenticated Persistence E2E — `e2e/authenticated-persistence.spec.ts`
- **#107** Browser Restart Persistence — Scenarios C/D in the same spec (no duplicate work)
- **#109** Delete Knowledge Space UX — `e2e/delete-space.spec.ts`
- **#112** Authenticated Signup Telemetry — `e2e/signup-telemetry.spec.ts`
- **#114** Beta Release Gate Finalization — `npm run beta:gates`
- **#113** Production Auth Configuration Verification — [PRODUCTION-AUTH-VERIFICATION.md](./PRODUCTION-AUTH-VERIFICATION.md)
- **#110** Fresh Account Production Smoke — [FRESH-ACCOUNT-PRODUCTION-SMOKE.md](./FRESH-ACCOUNT-PRODUCTION-SMOKE.md) (functionality + production A/B isolation **PASS**)

## Next

1. **#115 Beta Wave 1** — ops docs in [archive/BETA-WAVE-1.md](./archive/BETA-WAVE-1.md); invite first 5 testers
2. Stop building and observe (3–5 days)

## Do Not Build Yet

- Truth Assessment Layer (#166–#173) — [TRUTH-ASSESSMENT-LAYER.md](./TRUTH-ASSESSMENT-LAYER.md); post-beta moat, not Wave 1
- Slack
- Jira
- Confluence
- MCP
- cloud sync
- billing
- SSO
- progressive answers
- anticipatory retrieval
- intelligent routing
- team sharing
- duplicate persistence / browser-restart E2E (#106 covers #107)

## Core Rule

Supported, cited, or silent.

A user only sees knowledge belonging to their authenticated private workspace.
