# Hint / MeetHint — Product Backlog

**Last Updated:** 2026-09-16 (tickets #106–#107, #109, #114)

This document is the **source of truth** for Hint / MeetHint engineering, beta, product, security, enterprise, growth, and future work.

## Status legend

| Symbol | Meaning |
|--------|---------|
| ✅ | COMPLETE |
| 🟡 | PARTIAL / IN PROGRESS |
| ⬜ | TODO |
| ⏸ | DEFERRED |
| 🧪 | VALIDATE IN BETA |

## Operating rules

1. Do not start P1/P2 work while a P0 beta blocker exists.
2. Real beta evidence beats roadmap assumptions.
3. Do not optimize retrieval/routing unless real traces justify it.
4. Supported, cited, or silent.
5. A user may only view/search/retrieve/cite knowledge belonging to their authenticated workspace.
6. Private-by-default. No team sharing until explicitly implemented.
7. Never claim a feature complete because supporting architecture exists. Product UX + E2E must exist.
8. Do not silently upload local customer knowledge to Hint servers.
9. All security-sensitive changes need regression coverage.
10. Update this document whenever a ticket is completed, deferred, split, or materially changed.

---

## P0 — Closed beta / security / core product

### #1 Authentication + Account Lifecycle
**Status:** ✅ COMPLETE

Production auth implemented. Includes real sign-in/sign-out and authenticated account binding.

### #2 Personal Workspace Creation
**Status:** ✅ COMPLETE

One authenticated user receives one private workspace.

### #3 Tenant Isolation for Repositories
**Status:** ✅ COMPLETE

### #4 Database / Storage-Level Tenant Isolation
**Status:** ✅ COMPLETE for current local-first architecture

Corpus is account-scoped in IndexedDB rather than shared Postgres.

### #5 Tenant-Scoped Retrieval Before Ranking
**Status:** ✅ COMPLETE

### #6 Tenant-Isolated AI Context
**Status:** ✅ COMPLETE

### #7 Cross-Tenant Security Regression Suite
**Status:** ✅ COMPLETE

### #8 Tenant-Isolated Answer / Retrieval Cache
**Status:** ✅ COMPLETE

### #9 Secure Object Storage
**Status:** ⏸ DEFERRED

Required only when source content or derived corpus becomes server-side.

### #10 Secure Background Workers
**Status:** ⏸ DEFERRED

Needed when ingestion / connectors / sync run server-side.

### #11 Secrets Management
**Status:** 🟡 PARTIAL

Audit production handling of:

- auth secrets
- provider API keys
- database credentials
- OAuth secrets
- deployment secrets

Never expose secrets client-side unintentionally.

### #12 Complete Data Deletion
**Status:** ⬜ TODO

Authenticated user must be able to delete:

- account
- workspace metadata
- local vault data
- server auth/session data
- cloud data later if sync exists

### #13 Multiple Repositories per Workspace
**Status:** ✅ COMPLETE

### #14 Multiple Documents per Workspace
**Status:** ✅ COMPLETE

### #15 Unified Workspace Source Model
**Status:** ✅ COMPLETE

### #16 Cross-Repo Retrieval
**Status:** ✅ COMPLETE

### #17 Real-Time Performance Telemetry
**Status:** ✅ COMPLETE

Real flight capture and latency tooling exist.

### #18 Anticipatory Retrieval
**Status:** ⏸ DEFERRED

Real measurements did not justify implementation.

### #19 Closed Beta Readiness
**Status:** ✅ COMPLETE

Feedback, onboarding, diagnostics, telemetry and beta gates implemented.

### #20 Beta Flight Recorder
**Status:** ✅ COMPLETE for beta foundation

Continue collecting real-world traces.

### #21 Answer Feedback
**Status:** ✅ COMPLETE

Useful / Not Useful and structured failure reasons.

### #22 Product Analytics + Retention Funnel
**Status:** 🟡 PARTIAL

Local beta analytics exist. Server-side aggregation intentionally not implemented yet.

### #23 Real-Meeting Quality Dashboard / Report
**Status:** 🟡 PARTIAL

CLI report exists. Do not build major customer-facing dashboard before beta evidence.

### #24 Crawlability / SEO
**Status:** 🟡 PARTIAL

### #25 Domain Reputation & Enterprise Security Compatibility
**Status:** 🟡 PARTIAL

**Completed:**

- first-party asset hardening
- security headers
- trust pages
- DMARC
- SPF
- CAA

**Pending:**

- vendor recategorization
- DKIM capable outbound mail
- security@ / abuse@ if desired
- DNSSEC later

### #26 Usage Metering
**Status:** ⬜ TODO

### #27 Stripe Subscription Billing
**Status:** ⬜ TODO

### #28 Central Entitlements
**Status:** ⬜ TODO

---

## P0.5 — Current beta launch work

### #105 Private Workspace Isolation E2E
**Status:** ✅ COMPLETE

**Canonical test:** `e2e/private-workspace.spec.ts`

**Required invariant:** User A uploads unique private content. User B can never:

- list it
- retrieve it
- guess its space ID
- receive its answers
- receive its citations
- see its history
- see its in-memory state

This test must remain part of: `npm run beta:gates`

### #106 Authenticated Persistence E2E
**Status:** ✅ COMPLETE

**Canonical test:** `e2e/authenticated-persistence.spec.ts` (helpers: `e2e/fixtures/persistence.ts`)

**Do not duplicate** — #107 and manual smoke steps 15–16 in #110 defer here.

Verify same authenticated user does **not** need to re-upload knowledge.

| Scenario | Test | Covers |
|----------|------|--------|
| A | Same user logout → login | Steps 1–10 below; sign-out/sign-in without re-upload |
| B | Account switch A → B → A | Tenant isolation + A's vault returns after B |
| C | Browser restart (persistent profile) | #107 browser restart |
| D | Refresh on `/home`, Ask, Live | #107 refresh recovery |

**Scenario A steps:**

1. User A signs in
2. Creates Knowledge Space
3. Uploads source
4. Indexes it
5. Searches successfully
6. Signs out
7. Signs back in as User A
8. Same Knowledge Space exists
9. Same source/index is usable without upload

**Also test:** A → logout → B → logout → A. A's knowledge must return only for A.

### #107 Browser Restart Persistence
**Status:** ✅ COMPLETE

**Covered by #106** — do not open a separate ticket or E2E.

| Acceptance criterion | Covered by |
|---------------------|------------|
| refresh | Scenario D in `e2e/authenticated-persistence.spec.ts` |
| browser restart | Scenario C in `e2e/authenticated-persistence.spec.ts` |
| same-account sign-out/sign-in | Scenario A in `e2e/authenticated-persistence.spec.ts` |
| tab close | Same persistent profile as Scenario C (Playwright `launchPersistentContext`) |

Confirm IndexedDB survives the above without re-upload.

### #108 Local Data Missing State
**Status:** ⬜ TODO

If account metadata references knowledge indexed on another browser/device, show a clear message such as:

> "This Knowledge Space is available on another device. Reconnect its sources on this device."

Do not show a broken/empty state.

### #109 Delete Knowledge Space UX
**Status:** ✅ COMPLETE

**Canonical test:** `e2e/delete-space.spec.ts`

Deleted Knowledge Space:

- disappears from home immediately (store `spaceCatalogEpoch` → home reload)
- clears active state; falls back to another space when one remains
- shows clean empty state when none remain
- `/context/{deletedId}` → `space-missing`
- does not affect other spaces or accounts

**Implementation:** `deleteSpace` on repository + `deleteStoredContext` in store.

### #110 Fresh Account Production Smoke
**Status:** ⬜ TODO

Run manually before beta invite:

1. New clean browser profile
2. Sign up/sign in
3. Create Knowledge Space
4. Add repo/PDF
5. Index
6. Ask supported question
7. Open citation
8. Ask unsupported question
9. Start Live
10. Receive live supported answer
11. Give 👍 feedback
12. Give 👎 feedback on another answer
13. Export diagnostics
14. Sign out
15. Sign back in
16. Verify persistence (automated: `e2e/authenticated-persistence.spec.ts` Scenario A/C)
17. Sign in as second user
18. Verify isolation (automated: `e2e/private-workspace.spec.ts` + Scenario B)

### #111 Beta Privacy Copy Cleanup
**Status:** ✅ COMPLETE

Copy must not imply that signing in uploads repos/PDFs to Hint servers.

**Communicates:**

- source/index data stays in browser in current local-first mode
- sign-in identifies/binds the private workspace
- only retrieved excerpts needed for a question may be sent to configured AI provider
- telemetry excludes raw source bodies/full transcripts

### #112 Authenticated Signup Telemetry
**Status:** 🧪 VALIDATE IN BETA

Ensure `USER_CREATED` / `SIGNUP` only represent a verified authenticated account.

**Never count:**

- `dev-user`
- `ws_anon_*`
- browser vault initialization

as real signup.

### #113 Production Auth Configuration Verification
**Status:** 🧪 VALIDATE IN BETA

Confirm deployed environment:

- auth enabled
- no dev-user production fallback
- callbacks correct
- allowed origins correct
- secrets present
- database/auth storage configured
- protected routes fail closed

### #114 Beta Release Gate Finalization
**Status:** ✅ COMPLETE

**Gate script:** `scripts/beta-gates.mjs` — E2E specs run serially with retries.

`npm run beta:gates` requires:

- unit tests
- typecheck
- latency gate
- real auth
- private workspace isolation E2E
- authenticated persistence E2E
- Knowledge Space E2E
- delete Knowledge Space UX E2E

### #115 Beta Wave 1
**Status:** ⬜ TODO

Invite **5** real technical users first.

Do not invite 20 immediately.

Observe for 3–5 days before expanding.

### #116 Beta Wave 2
**Status:** ⬜ TODO

Expand to 10–20 users only if Wave 1 shows no major:

- auth issue
- data isolation issue
- persistence issue
- onboarding blocker
- unsupported confident-answer regression

### #117 Beta Tester Scorecard
**Status:** ⬜ TODO

Track per tester:

- signup completed
- source connected
- time to first useful answer
- first live session
- questions asked
- supported answer rate
- silence rate
- useful %
- negative feedback reasons
- citation opens
- p50/p95 latency
- D1 return
- D7 return
- meetings used
- willingness to pay
- biggest frustration

### #118 Real Beta Telemetry Aggregation
**Status:** 🧪 VALIDATE IN BETA

Currently telemetry is primarily local.

Decide after first users whether to:

- **A.** manually collect privacy-safe diagnostic exports
- **B.** build minimal secure server-side aggregation

Do not build a full analytics platform prematurely.

---

## P1 — Product experience

### #29 Organization Workspace Model
**Status:** ⬜ TODO

Not needed for private-user beta.

### #30 Workspace Roles
**Status:** ⬜ TODO

Future: owner, admin, member, viewer

### #31 Local Private Mode
**Status:** 🟡 PARTIAL

Local-first foundation exists. Productize clearly after beta feedback.

### #32 Intelligent Source Routing
**Status:** ⏸ DEFERRED

Real performance data does not justify yet.

### #33 Automatic Question Detection
**Status:** 🟡 PARTIAL

Exists. Refine using real meeting data.

### #34 "Say This"
**Status:** 🟡 PARTIAL

Answer architecture supports it. Continue UI refinement during beta only if users struggle.

### #35 Progressive Answer Rendering
**Status:** ⏸ DEFERRED

Previous real validation found naive progressive rendering unsafe / low benefit.

### #36 Per-Meeting Source Prioritization
**Status:** ⬜ TODO

### #37 Answer Replay
**Status:** ⬜ TODO

### #38 Permission-Aware GitHub Integration
**Status:** ⬜ TODO

### #39 Connector Abstraction
**Status:** ⬜ TODO

### #40 Connections Dashboard
**Status:** ⬜ TODO

### #41 Meeting Prep
**Status:** ⬜ TODO

### #42 Brief Me
**Status:** ⬜ TODO

### #43 Private Meeting Overlay
**Status:** ⬜ TODO

### #44 Meeting Action Detection
**Status:** ⬜ TODO

### #45 Decision Detection
**Status:** ⬜ TODO

### #46 Post-Meeting Summary
**Status:** ⬜ TODO

### #47 Smart Work Context
**Status:** ⬜ TODO

### #48 Scalability / Load Architecture
**Status:** 🟡 PARTIAL

Current architecture sufficient for beta. Revisit with actual usage/load.

### #49 Least Privilege OAuth
**Status:** ⬜ TODO

Especially important for future GitHub/Google/Slack connectors.

### #50 Tenant-Aware Rate Limits
**Status:** ⬜ TODO

### #51 Adversarial / Red-Team Evaluation
**Status:** 🟡 PARTIAL

Harness exists. Expand with real beta failures.

### #52 Design Partner Program
**Status:** ⬜ TODO

### #53 Founding Pro Billing
**Status:** ⬜ TODO

### #54 Team Seat Billing
**Status:** ⬜ TODO

### #55 Billing Failure / Grace Period
**Status:** ⬜ TODO

### #56 Cancellation + Data Retention
**Status:** ⬜ TODO

### #57 Churn / Cancellation Intelligence
**Status:** ⬜ TODO

---

## P1 — Persistence / sync

### #119 Local-First Persistence Contract
**Status:** ⬜ TODO

Document exact guarantees:

**Same browser/device:**

- source persists
- index persists
- Knowledge Space persists

**Different browser/device:**

- not currently synchronized

**Cleared browser data:**

- local knowledge may be lost

### #120 Cloud Workspace Metadata
**Status:** ⬜ TODO / DESIGN FIRST

Potentially persist lightweight account metadata server-side:

- space names
- source references
- device availability state
- timestamps

Do not upload customer source bodies automatically.

### #121 Optional Secure Knowledge Sync
**Status:** ⏸ DEFERRED

Design optional cross-device sync.

**Possible modes:**

| Mode | Description |
|------|-------------|
| LOCAL ONLY | Maximum privacy. Available on this device. |
| SECURE SYNC | Encrypted cloud persistence. Available across user's devices. |
| COMPANY MANAGED | Sources connected through approved enterprise connectors. |

Do not implement until product requirements and threat model are defined.

### #122 Encrypted Cloud Source Storage
**Status:** ⏸ DEFERRED

Required if Secure Sync stores raw content.

Needs: encryption at rest, per-workspace ownership, deletion, source versioning, key strategy, access auditing.

### #123 Derived Index / Embedding Sync
**Status:** ⏸ DEFERRED

Investigate syncing encrypted derived indexes instead of raw source data.

### #124 Device Awareness
**Status:** ⏸ DEFERRED

Allow workspace to know which devices currently hold local source material.

### #125 Reconnect Source Flow
**Status:** ⬜ TODO eventually

When local files are unavailable:

- reconnect repo/folder
- re-index safely
- retain logical source identity
- avoid duplicates

---

## P2 — Intelligence / moat

### #58 Multi-Source Grounded Synthesis
**Status:** ✅ COMPLETE

### #59 Contradiction Detection
**Status:** 🟡 PARTIAL

### #60 Source Authority + Freshness
**Status:** ⬜ TODO

### #61 "What Changed?" Temporal Intelligence
**Status:** ⬜ TODO

### #62 Technical Claim Audit
**Status:** 🟡 PARTIAL

### #63 Meeting Guardian
**Status:** ⬜ TODO

### #64 Expert Finder
**Status:** ⬜ TODO

### #65 Organizational Memory
**Status:** ⬜ TODO

### #66 Living Memory
**Status:** ⬜ TODO

### #67 Knowledge Conflict Center
**Status:** ⬜ TODO

### #68 Knowledge Health
**Status:** ⬜ TODO

### #69 Architecture Map
**Status:** ⬜ TODO

### #70 Cross-Repo Dependency Reasoning
**Status:** ⬜ TODO

### #71 Semantic Question Deduplication
**Status:** ⬜ TODO

### #72 Real-Time Load Testing Harness
**Status:** ⬜ TODO

### #73 BYO MCP / Enterprise MCP Gateway
**Status:** ⬜ TODO

### #74 Personal Value Dashboard
**Status:** ⬜ TODO

### #75 Usage-Based Upgrade Moments
**Status:** ⬜ TODO

### #76 Horizontal Persona / Context Modes
**Status:** ⏸ DEFERRED

### #77 General Document Workspace
**Status:** 🟡 PARTIAL

---

## P3 — Enterprise

### #78 Enterprise Identity / SSO / SAML
**Status:** ⬜ TODO

### #79 Source ACL Propagation
**Status:** ⬜ TODO

Critical before shared enterprise knowledge.

### #80 Security Audit Center
**Status:** ⬜ TODO

### #81 Private / VPC Deployment
**Status:** ⬜ TODO

### #82 Customer-Managed Encryption Keys
**Status:** ⬜ TODO

### #83 SOC 2 Readiness
**Status:** ⬜ TODO

### #84 Workflow Actions
**Status:** ⬜ TODO

### #85 Team Shared Intelligence
**Status:** ⬜ TODO

Do not implement before private-user model is proven.

### #86 Admin ROI Dashboard
**Status:** ⬜ TODO

### #126 SCIM Provisioning
**Status:** ⬜ TODO

Future enterprise account lifecycle.

### #127 Enterprise Data Residency
**Status:** ⬜ TODO

Only make residency claims after architecture supports them.

### #128 Audit Logs
**Status:** ⬜ TODO

Track security-sensitive enterprise events.

### #129 Workspace Sharing Permissions
**Status:** ⬜ TODO

Future explicit sharing model. Private by default.

### #130 Source-Level Permissions
**Status:** ⬜ TODO

### #131 Enterprise Retention Policies
**Status:** ⬜ TODO

---

## Future personas

### #87 Professional Work Mode
**Status:** ⏸ DEFERRED

### #88 Sales / Client Call Mode
**Status:** ⏸ DEFERRED

### #89 Education / Lecture Mode
**Status:** ⏸ DEFERRED

### #90 Teacher Mode
**Status:** ⏸ DEFERRED

### #91 Interview Preparation
**Status:** ⏸ DEFERRED

Preparation only.

### #92 Research Mode
**Status:** ⏸ DEFERRED

### #93 Context / Persona Packs
**Status:** ⏸ DEFERRED

---

## Marketing / growth

### #94 Homepage Repositioning
**Status:** 🟡 PARTIAL

**Core positioning:** Hint is not a generic AI meeting notes app.

**Primary idea:** "Know before you answer."

**Product:** Real-time truth layer for technical customer conversations.

### #95 Homepage Live Answer Demo
**Status:** 🟡 PARTIAL

### #96 "Not Another Meeting Notes App" Section
**Status:** ⬜ TODO

### #97 Security / Privacy Marketing
**Status:** 🟡 PARTIAL

### #98 Founding Beta Landing Page
**Status:** ⬜ TODO

### #99 30–45 Second Product Demo
**Status:** ⬜ TODO

### #100 Marketing Analytics Funnel
**Status:** ⬜ TODO

### #101 Product X Account
**Status:** ⬜ TODO

### #102 LinkedIn Company Page
**Status:** ⬜ TODO

### #103 Brand / Company Rename Evaluation
**Status:** 🟡 OPEN

No rename currently approved.

### #104 Product Hunt Preparation
**Status:** ⏸ DEFERRED

Do not launch until retention / trust / onboarding have evidence.

### #132 Beta Recruitment
**Status:** ⬜ TODO

**Target:**

- Sales Engineers
- Solutions Engineers
- Solutions Architects
- Technical Account Managers
- Forward Deployed Engineers
- senior engineers
- technical consultants
- technical founders

### #133 Beta Interview Script
**Status:** ⬜ TODO

Ask after use:

- What did you expect Hint to do?
- What confused you?
- Which answer did you trust least?
- When would you keep Hint open?
- What would stop you from using it?
- What would you be disappointed to lose?
- Would you pay for it?

### #134 Beta Demo Dataset
**Status:** ⬜ TODO

Create a clean internal dataset that demonstrates:

- single-source answer
- multi-repo answer
- repo + PDF answer
- contradiction
- unsupported question / silence
- exact citation
- live answer

### #135 Beta Onboarding Copy Polish
**Status:** 🟡 PARTIAL

Avoid internal/developer terminology. Keep onboarding short.

### #136 User Header Polish
**Status:** ✅ COMPLETE

User display shows first name cleanly; full name available on hover.

### #137 "Start Live" CTA Clarity
**Status:** ✅ COMPLETE

Header chip renamed to "Start Live"; onboarding copy positions Live as core experience.

### #138 Suggested Question Relevance
**Status:** ✅ COMPLETE

Suggestions only appear when indexed sources are ready.

---

## Quality / reliability

### #139 Unsupported Answer Regression Suite
**Status:** 🟡 PARTIAL

Continue adding cases from beta. Wrong confident answers are the highest-risk product failure.

### #140 Citation Integrity Suite
**Status:** 🟡 PARTIAL

Every citation must resolve to the evidence used.

### #141 Source Identity Regression Suite
**Status:** ✅ COMPLETE foundation

Maintain same-path-across-repos coverage.

### #142 Multi-Source Capability Regression
**Status:** ✅ COMPLETE foundation

Maintain combined-source scenarios.

### #143 Account Switching Regression
**Status:** ✅ COMPLETE foundation

Keep actual production auth version in beta gates.

### #144 Diagnostics Privacy Regression
**Status:** ✅ COMPLETE foundation

### #145 Performance Regression Gate
**Status:** ✅ COMPLETE foundation

Representative supported p95 target: **< 2 seconds**

Current validated fixture baseline: **~816 ms p95**

Do not optimize for lower latency unless beta behavior says latency is actually a problem.

### #146 Error State QA
**Status:** 🧪 VALIDATE IN BETA

Validate:

- indexing failure
- no knowledge
- provider error
- missing provider key
- mic permission denied
- auth expired
- source unavailable
- unsupported answer

### #147 Offline / Network Failure Behavior
**Status:** ⬜ TODO

### #148 Browser Compatibility
**Status:** ⬜ TODO

Validate primary supported browsers before broad beta.

### #149 Large Repository Behavior
**Status:** ⬜ TODO

Measure indexing time/memory on large source sets.

### #150 Large PDF / Document Behavior
**Status:** ⬜ TODO

---

## Billing / commercial

### #151 Pricing Validation
**Status:** 🧪 VALIDATE IN BETA

Potential starting concepts only: Free, Founding Pro, Pro, Team, Enterprise

Do not finalize pricing without user evidence.

### #152 Willingness-to-Pay Measurement
**Status:** ⬜ TODO

Ask beta testers: *"Would you pay $29/month for this as it exists today?"*

This is research, not final pricing.

### #153 Stripe Customer Lifecycle
**Status:** ⬜ TODO

### #154 Subscription Entitlement Service
**Status:** ⬜ TODO

### #155 Seat Management
**Status:** ⬜ TODO

### #156 Trial / Founding User Rules
**Status:** ⬜ TODO

---

## Connectors

### #157 GitHub Connector
**Status:** ⬜ TODO

Do not build until beta users show need.

### #158 Google Drive Connector
**Status:** ⬜ TODO

### #159 Notion Connector
**Status:** ⬜ TODO

### #160 Confluence Connector
**Status:** ⬜ TODO

### #161 Slack Connector
**Status:** ⬜ TODO

### #162 Jira Connector
**Status:** ⬜ TODO

### #163 Connector Permission Model
**Status:** ⬜ TODO

### #164 Connector Sync Scheduling
**Status:** ⬜ TODO

### #165 Connector Revocation / Cleanup
**Status:** ⬜ TODO

---

## Current recommended execution order

Do these next:

1. **#112** Verify authenticated signup telemetry
2. **#113** Verify production auth configuration
3. **#110** Fresh Account Production Smoke (persistence/isolation: defer to `e2e/authenticated-persistence.spec.ts` + `e2e/private-workspace.spec.ts`)
4. **#115** Invite Beta Wave 1: 5 users
5. Stop feature development temporarily
6. Observe real use for 3–5 days
7. Fix only beta-breaking defects
8. Expand to **#116** Beta Wave 2 if stable

After Beta Wave 1, the roadmap **must** be reprioritized using observed evidence.

**Do not automatically start** until beta evidence justifies them:

- Slack
- Jira
- Confluence
- MCP
- routing
- anticipatory retrieval
- progressive rendering
- billing
- enterprise features

---

## Beta success questions

The first beta is trying to answer:

1. Can a new user set Hint up without help?
2. Can they reach a useful answer quickly?
3. Does Hint answer before the conversation moves on?
4. Do users trust the citations?
5. Does Hint stay silent when evidence is insufficient?
6. Does the user keep Hint open during real meetings?
7. Do users return the next day?
8. Do they return the next week?
9. Do they care if Hint disappears?
10. Will anyone pay for it?

---

## Core product principles

**"Supported, cited, or silent."**

**"Know before you answer."**

**"Confidence is not evidence."**

**"Every answer comes with proof."**

**Privacy rule:** A user can only view, search, retrieve, cite, or generate answers from knowledge authorized for their authenticated workspace.

**Product identity:** Hint is a real-time truth layer for technical conversations, not another meeting transcription or note-taking application.

**Initial wedge:** People who are asked technical questions live and need trustworthy answers immediately.

---

## Related documents

- [NEXT.md](./NEXT.md) — current phase and immediate focus (derived from this backlog)
