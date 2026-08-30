# Phase 4A.8.1 — Real-world PDF safety baseline

**Frozen 2026-08-30. Do not overwrite this directory.**

Landing stays **PDF · Coming soon**. Phase 4A.9 was not started.

This is the safety floor after QuestionContract. Future coverage work is compared against this snapshot and must not weaken it.

---

## What changed in the architecture

Before:

> A sentence is supported by the PDF → therefore it may answer.

After:

```
Does this source match?
        ↓
Does this claim establish the required subject?
        ↓
Does it answer the requested relation?
        ↓
Is it the expected answer type?
        ↓
Does it satisfy enumeration / shape?
        ↓
Is the exact evidence current and supported?
        ↓
Speak
```

Admission is not evidence. Support remains last.

---

## Headline

| | 4A.7 real-world | 4A.8.1 |
|---|---|---|
| Genuine wrong-intent | 60 | **0** |
| Unanswerable spoken | 20 | **0** |
| Machine-strict wrong-intent | 68/126 (54%) | 4/126 (3.2%) — category I only |
| Answerable hit | 14/89 (16%) | 9/89 (10.1%) |
| Unsupported | 0 | 0 |
| Fabricated provenance | 0 | 0 |
| Page / evidence-location accuracy | 100% | 100% |

Coverage drop is the expected cost of “when uncertain, shut up.” It is not a product-done metric.

Safety floor now:

| Truth of evidence | ✓ |
| Truth of provenance | ✓ |
| Truth of relevance | ✓ |
| Coverage | ✗ |

Achieved without embeddings, retrieval tuning, models, or weaker provenance.

---

## Controlled PDF cost (freeze this number)

Same 4A.4 / 4A.4.1 development Card bench, before vs after QuestionContract:

| | Answerable hits |
|---|---|
| Before QuestionContract (4A.4.1) | **22/22** |
| After QuestionContract (this freeze) | **17/22** |

Wrong-intent on that bench stayed **0**. The five silences are the measurable admission cost:

- `lecture-concurrent`
- `multi-deadlock`
- `paper-checks`
- `bullets-list`
- `slides-phantom`

This is **not** a regression to fix by relaxing the contract. Future work must not quietly regain those five Cards by weakening QuestionContract. Recovering them is allowed only if the spoken claim independently satisfies the frozen invariants below (typically after parser/chunk work, not admission loosening).

Artifacts:

- Pre-contract capability: `.eval/phase4a/card-bench-4a41.json` (22/22) — do not overwrite
- Post-contract cost: `.eval/phase4a/4a8.1/card-bench.json` (17/22) — do not overwrite

---

## Frozen invariants

Do not let future coverage work weaken any of these:

1. **df=0** — a meaningful required term stays required even when corpus df = 0.
2. **Explicit source selectors** remain hard filters. Rank cannot override them.
3. **Ambiguous source selectors** cause silence. No type-preference fallback.
4. **Failed / scanned / refused / empty named documents** never fall back to another PDF.
5. **Subject compatibility** applies to the actual spoken claim / mapped range, not page title, outline, neighbor chunk, or unmapped metadata.
6. **Predicate compatibility** is required. `shape = what` is not a pass-through.
7. **Answer-type compatibility** is required.
8. **Enumeration** remains coherent and page-local. Headings and single members are not lists.
9. **Unknown relations fail closed.** Prefer silence over an unrecognized predicate.
10. **Thread** resolves source references only. It does not satisfy subject, predicate, answer type, or support.
11. **Evidence support** remains the final safety check. Currentness and word-level support stay last.
12. **No embeddings** are ever used as proof that a passage answers a question.

Machine copy: `invariants.json`.

---

## The 4A.7 corpus is development data

The 126-question 4A.7 set is **permanently** a development / regression corpus.

It must not be the final ship test. That remains a later untouched third-party blind corpus (4A.11). Do not tune parser, retrieve, or admission on these 126 questions to manufacture coverage.

---

## Next bottleneck (not this freeze)

Admission among the original 68 is closed. Retrieval misses among those 68: **0**. Parser/source cases: **9** (may stay silent). Remaining coverage gap is PDF representation:

```
Real PDF → layout classification → uncertain → isolated lines
        → 50–70 chunks/page → noise + chunk caps
        → missing coherent evidence → safe silence
```

`cs229-notes.pdf`: 27/28 pages skipped. QuestionContract cannot speak evidence that never became a usable chunk. Attention / BERT / ResNet-style papers still not recognized as two-column.

That is later parser work. **Do not begin it in this freeze.**

---

## Three baselines future work must compare against

See `.eval/phase4a/BASELINES.md`.

| Baseline | Role | Must hold |
|---|---|---|
| **Phase 3.5** | Code truth | Bit-for-bit Cards / chips / retrieval vs `.eval/phase35/` |
| **Phase 4A.4.1** | Controlled PDF capability | Fixture bench in `card-bench-4a41.json`; wrong-intent 0; 22/22 is pre-contract capability |
| **Phase 4A.8.1** | Real-world PDF safety | This directory: genuine wrong-intent 0, unanswerable spoken 0, invariants above |

---

## Artifacts in this directory (frozen)

| File | Contents |
|---|---|
| `metrics.json` | 126-question development metrics |
| `card-run.json` | Full per-question run |
| `surviving.json` | Four category-I machine-strict leftovers |
| `unanswerable-20.json` | 20 → silence |
| `answerable-48.json` | 48 after-state |
| `regression-set.json` | Designed 4A.8 cases, 24/24 |
| `card-bench.json` | Post-contract 4A.4 bench (17/22) |
| `retrieval-bench.json` | 4A.3 ranks re-run; frozen 4A.3 file not overwritten |
| `invariants.json` | Closed invariant list |
| `controlled-pdf-cost.json` | 22/22 → 17/22 and the five IDs |
| `REPORT.md` | Implementation deliverable |

Do not overwrite `.eval/phase35/`, `.eval/phase4a/card-bench-4a41.json`, or `.eval/phase4a/release/`.
