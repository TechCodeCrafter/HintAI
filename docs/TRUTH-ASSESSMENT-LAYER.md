# Truth Assessment Layer (post-beta moat)

**Status:** Future P2 — do not build during Beta Wave 1 (#115)  
**Epic:** [#166 Truth Assessment Layer](./PRODUCT-BACKLOG.md#166-truth-assessment-layer-epic)  
**Last updated:** 2026-09-17

## Why this exists

Hint’s current answer loop already establishes:

1. Question gating
2. Hybrid retrieval
3. Evidence admission
4. Literal verification
5. Cited answer generation

**Truth Assessment** is the next layer — between “the evidence says this” and “this is the truth for *this* user, customer, place, version, and date.”

That is a real moat. Generic enterprise search stops at retrieval + ranking. Hint can answer whether an claim is **verified for the current context**.

## Pipeline

```
Question
   ↓
Question Gate              ← already built
   ↓
Hybrid Retrieval           ← already built
   ↓
Evidence Admission         ← already built
   ↓
Literal Verification       ← already built
   ↓
┌───────────────────────────────┐
│       TRUTH ASSESSMENT        │  ← NEW
│                               │
│ Source authority              │
│ Source freshness              │
│ Effective date                │
│ Customer applicability        │
│ Geography applicability       │
│ Product/version applicability │
│ Contradiction detection       │
│ Superseded-source detection   │
└───────────────────────────────┘
   ↓
Truth State
   ↓
Card
```

## Truth states (structured output)

| State | Meaning |
|-------|---------|
| **VERIFIED** | Supported by authoritative, current, applicable evidence for this context |
| **POSSIBLE** | Supported textually but applicability or authority is uncertain |
| **CONFLICTING** | Multiple applicable sources disagree (e.g. repo vs signed contract) |
| **STALE** | Source is authoritative and explicit but expired or superseded |
| **NO VERIFIED ANSWER** | Insufficient verified evidence — prefer silence over confident wrong |

**STALE** is distinct from **POSSIBLE**: a source can be explicit and authoritative yet no longer effective.

## Design principle: not another LLM opinion layer

Truth Assessment must be driven by **structured metadata and evidence** whenever possible — not free-form model judgment.

Example source record:

```
Source A
  authority      = contract
  effective      = 2026-01-01
  expires        = 2027-01-01
  region         = Canada
  customer       = Acme
  productVersion = Enterprise v4
```

Hint can then reason:

- *“This answer is supported by a current signed contract for this customer.”*

versus:

- *“This repo says yes, but the customer contract says no.”*

That is where Hint becomes stronger than generic enterprise search.

## Backlog breakdown

| Ticket | Scope |
|--------|--------|
| [#166](./PRODUCT-BACKLOG.md#166-truth-assessment-layer-epic) | Epic — orchestration + contract |
| [#167](./PRODUCT-BACKLOG.md#167-truth-assessment-engine) | Engine between literal verification and card |
| [#168](./PRODUCT-BACKLOG.md#168-source-authority-model) | Authority tiers (contract, policy, repo, wiki, …) |
| [#169](./PRODUCT-BACKLOG.md#169-freshness--effective-date-model) | Freshness, effective/expires, **STALE** |
| [#170](./PRODUCT-BACKLOG.md#170-applicability-rules) | Customer, geography, product/version scoping |
| [#171](./PRODUCT-BACKLOG.md#171-truth-contradiction-detection) | Cross-source conflict (extends #59) |
| [#172](./PRODUCT-BACKLOG.md#172-superseded-source-detection) | Supersession chains, deprecated docs |
| [#173](./PRODUCT-BACKLOG.md#173-truth-state-ui) | Card surfaces VERIFIED / POSSIBLE / CONFLICTING / STALE / NO VERIFIED ANSWER |

## When to start

After Beta Wave 1 (#115) and Wave 2 (#116) produce evidence that the **current** answer loop (supported, cited, or silent) works in the wild.

Reprioritize using beta scorecard data — especially unsupported confident answers, citation trust, and contradiction reports.

## Related

- [PRODUCT-BACKLOG.md](./PRODUCT-BACKLOG.md) — P2 tickets #59, #60, #166–#173
- [archive/BETA-WAVE-1.md](./archive/BETA-WAVE-1.md) — observation metrics that inform Truth Assessment priority
