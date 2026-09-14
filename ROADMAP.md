# MeetHint product roadmap

Ordered priorities for what to build next. This is the sequence we bet on — not a
parallel wish list. Each phase should be shippable and testable before the next
starts.

For what exists today, see [PRODUCT.md](./PRODUCT.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Standard vocabulary

Retire the mixed terms *pack*, *context*, *material*, and *source* in product copy.
Use only:

| Term | Meaning |
|------|---------|
| **Workspace** | Account or team boundary — who owns data and who can see it |
| **Knowledge Space** | Grouped knowledge for a project or domain (repos, docs, later Jira/Confluence) |
| **Source** | One ingest unit: repo, document, Jira project, etc. |
| **Session** | A live conversation (the cockpit while Listen is active) |
| **Answer** | A supported response shown on the Card — cited or silent with reason |

Code may still say `pack` or `context` until a rename pass; user-facing language
should follow this table immediately.

---

## Phase 0 — Identity and tenant isolation (first)

**Before anything else.** No feature work that widens the blast radius until this
holds.

- Proper authentication (not passthrough)
- Personal workspaces per user
- `workspace_id` on every repo, document, chunk, and answer record
- Tenant-scoped retrieval, caches, and embeddings
- Cross-user security tests: User A must **never** infer User B's repo through
  search, citations, cache, embeddings, or AI output

**Exit criteria:** automated isolation suite green; manual red-team checklist
passed.

---

## Phase 1 — Knowledge Spaces (multi-source default)

The product still *feels* like “pick one repo/context.” Change the mental model:

- A **Knowledge Space** holds many sources (e.g. 4 repos + 20 docs; later Jira/Confluence)
- A **Session** searches the whole authorized space — not one file tree
- UI: space picker and “Add knowledge” instead of a single-folder mindset

**Do not** build Confluence, Slack, Jira, MCP, and enterprise VPC all at once.
GitHub/local repos + documents are enough to prove the core loop. Build the
**connector abstraction** now; add integrations one at a time after the loop is
excellent.

---

## Phase 2 — Intelligent source routing

At 40 repos in a space, brute-force search is too slow and noisy.

- Maintain lightweight **source summaries** (topic, domain, freshness)
- From partial transcript, **rank likely sources** before deep retrieval
- Search top candidates deeply; **expand outward** only when confidence is low

Pairs with anticipatory retrieval (Phase 4).

---

## Phase 3 — Latency instrumentation (measure before optimizing)

Instrument each stage separately:

| Stage | What to measure |
|-------|-----------------|
| Transcription | Utterance → text |
| Question detection | Gate verdict latency |
| Routing | Source shortlist time |
| Retrieval | Hybrid search |
| Reranking | If applicable |
| Answer composition | LLM / localCard |
| Evidence validation | Support check |
| Render | Card paint |

**Product KPI:** p95 **first supported answer under 2 seconds** for common
questions in a warmed session.

Flight recorder and `npm run flight:summary` are the start of this; extend with
per-stage spans and session-level rollups.

---

## Phase 4 — Anticipatory retrieval (high bet)

While someone is still asking:

> “On the authentication service, when ZPA provisioning fails…”

Hint should already be **warming** auth / ZPA / provisioning sources. When the
sentence ends, the system is **narrowing**, not starting from zero.

- Partial-transcript hooks into source routing (Phase 2)
- Background prefetch of likely chunks / embeddings
- Must not leak cross-tenant data or burn quota on wrong guesses

---

## Phase 5 — Answer UI as the hero

Keep the **three-column live workspace** — it is closer to the right product than
dashboard mockups. Refine; do not redesign around a giant analytics shell.

**Right panel (Card) should be unmistakable:**

```
SAY THIS
“The retry limit is three because additional attempts caused duplicate downstream processing.”
High confidence · 3 sources
```

Exact evidence underneath. The user never parses a paragraph before speaking.

Smaller UI moves only — no futuristic dashboard, no Otter-style feature sidebar.

---

## Phase 6 — Calmer home

Reduce home to:

```
What do you need to know?
Ask across your knowledge…

[ Start live session ]  [ Add knowledge ]

Knowledge Spaces
  Backend
  IAM Platform
  Product Docs

Recent Sessions
  Architecture Review
  IAM Migration
```

No giant analytics dashboard on home.

---

## Phase 7 — Closed beta instrumentation

Every Answer should capture (local-first, exportable — flight log pattern):

- Shown vs suppressed
- Latency breakdown (Phase 3)
- Evidence count
- Copied / evidence opened
- Thumbs up/down + reason (shipped on `phase-0-feedback-summary`)

**Goal:** learn why people stop using the product before marketing spend.

---

## Phase 8 — Moat features (after the loop is excellent)

Build in this order:

1. Contradiction detection
2. “What changed?”
3. Meeting Prep
4. Meeting Guardian
5. Organizational memory
6. Expert finder
7. Knowledge Health

---

## Explicitly deferred

| Item | Why wait |
|------|----------|
| Confluence / Slack / Jira connectors | Prove loop on git + docs first |
| Enterprise VPC | After tenant isolation + beta signal |
| MCP surface | After connector abstraction is stable |
| Full product rename in code (`pack` → space) | After UX copy stabilizes |

---

## Current alignment (repo snapshot)

| Roadmap item | Status |
|--------------|--------|
| Silero utterance admission + audio e2e | Shipped (#46) |
| Flight recorder + export + summary CLI | Shipped |
| Thumbs-down feedback reasons | Shipped (feedback branch) |
| Tenant isolation | **Not started — Phase 0 blocker** |
| Knowledge Spaces UX | Conceptual only (`context` ≈ one folder) |
| Source routing / anticipatory retrieval | Not started |
| Per-stage latency KPI | Partial (answer-level latency in flight log) |
| Answer hero layout | Partial (Card exists; not yet “SAY THIS” pattern) |
| Terminology standardization | Documented here; copy not fully migrated |

---

## Decision log

- **2026-03:** Three-column live session is the product shell; home stays calm;
  security and spaces before integrations; anticipatory retrieval is the main
  retrieval bet after instrumentation.
