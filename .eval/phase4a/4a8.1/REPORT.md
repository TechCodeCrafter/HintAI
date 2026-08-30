# Phase 4A.8.1 — Question contract + document admission safety

**FROZEN 2026-08-30.** Canonical freeze: `BASELINE.md`. Do not overwrite this directory.

Frozen 4A.7 release artifacts were not modified. Landing still says **PDF · Coming soon**. Phase 4A.9 was not started.

Primary target: wrong-intent → 0% on genuine relevance. Coverage is secondary.

### Controlled PDF cost (part of this freeze)

4A.4 / 4A.4.1 development Card benchmark:

- before QuestionContract: **22/22**
- after QuestionContract: **17/22**

Wrong-intent stayed 0. The five silences (`lecture-concurrent`, `multi-deadlock`, `paper-checks`, `bullets-list`, `slides-phantom`) are the cost of stricter admission. Do not regain them by weakening the contract. See `controlled-pdf-cost.json`.

## Acceptance

| Gate | Result |
|---|---|
| Phase 3.5 code Cards / chips / retrieval | **unchanged** (`phase35-compare` ok) |
| PDF unsupported | **0** |
| Fabricated provenance | **0** |
| Page / evidence-location accuracy | **100%** |
| Unanswerable spoken | **0** (was 20) |
| Genuine relevance wrong-intent | **0** |
| Machine-strict wrong-intent | **4/126 (3.2%)** — all frozen category-I eval-span |
| Retrieval / parser / IDF / weights | **not changed** |
| Answerable hit | **9/89 (10.1%)** — down from 14/89 (16%) |

---

## 1. Files changed (this phase)

Document admission only:

- `src/lib/search/question-contract.ts` — QuestionContract
- `src/lib/search/document-identity.ts` — filename / title / author / type / readiness
- `src/lib/search/local-card.ts` — contract before document Cards
- `src/lib/search/document-card.ts` — claim-level contract on the spoken range
- `src/lib/search/thread.ts` — optional `sourceIds` from document citations
- `src/lib/search/__tests__/question-contract.test.ts`
- `src/lib/search/__tests__/document-card.test.ts` — lookup now passes `documents`
- `scripts/pdf-4a8.1-gate.ts`
- `scripts/run-tests.mjs` — includes the contract tests
- `.eval/phase4a/4a8.1/*` — new outputs only

Not changed: retrieve weights, IDF, `MAX_PER_FILE`, PDF parser, column detection, normalization, chunking, evidence mapping, currentness, word-level support, viewer, landing, code/TextEvidence path.

## 2. Final QuestionContract type

```ts
type QuestionContract = {
  shape: Shape
  subject: { requiredTerms: string[]; optionalTerms: string[] }
  sourceSelector?: {
    raw: string
    explicit: boolean
    resolvedBy: "filename" | "title" | "author" | "document-type" | "thread" | "unresolved"
    sourceIds: string[]
    ambiguous: boolean
    emptyTyped: boolean
    strength: "named" | "type" | "thread"
  }
  predicate?: { kind: PredicateKind; requiredSignals: string[] }
  answerExpectation: AnswerExpectation
  enumeration?: { requested: boolean; expectedCount?: number }
  needsThreadSource: boolean
  needsDefinitionCopula: boolean
  whenPredicative?: string
  requiredVerb?: string
}
```

The contract constrains eligibility. It is not evidence.

## 3. Required vs optional terms

From `contentWords`, after stripping source-selector tokens:

**Optional (never required merely because corpus-absent):**

- framing / discourse: please, tell, say, professor, paper, guide, policy, document, pdf, mention, thing, one, …
- asking verbs: freeze, list, report, implement, solve, provide, …
- extracted document-type words once they sit on `sourceSelector`

**Required:** remaining content terms — the things whose absence changes what was asked.

If that set is empty, leftover non-framing terms are promoted (so “What does LoRA freeze?” still requires `freeze`).

Enumeration count words (`two`…`six`) are not required subjects.

“paper” is framing once a source selector exists. “professor” is framing when it only means “what did the professor say about X?”.

## 4. df=0 handling

Required terms are **not** dropped when corpus df = 0.

“Does the LoRA paper mention salary?” keeps `salary`. A LoRA/patent sentence without salary is rejected. Silence if no eligible claim contains it.

Framing words still do not become required just because they are absent (`please`, `again`, `basically`, …).

IDF/df remains a retrieve ranking signal only.

## 5. Source-selector implementation

Deterministic matches against loaded identities only. No aliases.

| Signal | Behavior |
|---|---|
| Unique filename / stem / title / author | Hard-filter to that `sourceId` |
| Explicit other source | Other sources ineligible even if retrieve rank #1 |
| Named selector, 0 or 2+ hits (e.g. “NIST” with three NIST PDFs) | Unresolved → silence, no type-preference fallback |
| Generic “the paper / lecture / guide / policy” | Hard-filter **only if unique**. Ambiguous type is weak (no arbitrary pick, no silence-for-ambiguity) |
| Scanned / encrypted / refused / empty selected source | `emptyTyped` → silence, no fallback |
| Filename `*.pdf` | Stem match |

## 6. Predicate taxonomy

Small closed set from the 4A.7 failure classes:

`definition` · `recommendation` · `cost` · `contact` · `location` · `requirement` · `failure` · `procedure` · `rationale` · `ownership` · `enumeration` · `quantity` · `naming` · `other`

Unrecognized asked relations fail closed (quantity without a value, contact without a number, recommendation without recommend/should language, …). `what` shape is not a pass-through.

`requiredVerb` additionally requires the asked relation verb (“what does X freeze”, “how do they solve”, “which Y did they implement”) on the claim, and rejects a different first action or a modal hedge (`can freeze`).

## 7. Answer-expectation taxonomy

`definition` · `explanation` · `procedure` · `location` · `person` · `quantity` · `contact` · `enumeration` · `failure` · `other`

WHO needs ownership language, not a name. WHERE needs a locative/storage relation, not a page. WHY needs explicit rationale. HOW MUCH / score / rate need a **numeric value**, not the word “score”. PHONE needs contact evidence. FAILURE needs a relevant consequence.

“What is X” also sets `needsDefinitionCopula` (claim must predicate `X … is` / `is … X`).

## 8. Enumeration behavior

- Explicit count (“three pillars”) → coherent page-local list with at least that many members. A heading or a single member is rejected.
- Unbounded “which items / which isolation levels” → multiple-member list required.
- One mapped block only. Distant chunks / separate pages are not merged.

## 9. Claim-level admission sequence

1. retrieve (weights frozen)
2. build QuestionContract
3. `contractBlocksAll` (ambiguous named / empty selected / stale thread) → silence
4. source-selector filter on hits
5. extract candidate claim/block
6. required subject on the **claim**
7. predicate / required verb
8. answer expectation
9. enumeration
10. existing Shape (`absence` stays silent)
11. sayability / generic smashed-edge gate
12. map exact range
13. currentness
14. support
15. Card

Final compatibility is on the spoken evidence range, not page title, outline, neighbor chunk, or unmapped metadata.

## 10. Thread / source-reference behavior

`ThreadContext.sourceIds` records document citations from the last spoken Card.

“that paper / policy / guide / lecture / one” resolves only when exactly one prior `sourceId` is live. Follow-up evidence must still pass subject, predicate, expectation, shape, mapping, currentness, and support.

Ambiguous or missing thread source → silence. Thread does not satisfy the question.

## 11. Regression-set results

`.eval/phase4a/4a8/regression-set.json` (24 designed cases) → `.eval/phase4a/4a8.1/regression-set.json`

**24/24 pass.** Every case is SILENCE (safety-first). `cisa-what` was designed as “correct CISA source”; the gold definitional sentence was not admitted, so it is a safe silence rather than a recovered hit. Coverage was not chased.

## 12. 20 unanswerable cases before / after

All 20 that spoke in 4A.7 are **SILENCE**.

Including: LoRA salary, scanned PDF, encrypted PDF, IRS SSN, BERT phone, home address, annual growth rate, GPU vendor, ZTA budget, hybrid SLA, figure secret, ransom pay, retry/passwords, …

Unanswerable spoken: **20 → 0**.

## 13. 48 answerable-wrong cases before / after

| After | n |
|---|---|
| SILENCE | 44 |
| SPOKE-EVAL-SPAN-I (human-acceptable, frozen span miss) | 4 |
| SPOKE-WRONG (genuine) | 0 |
| HIT (recovered) | 0 |

The four remaining spoken Cards are `attn-arch`, `tm-what`, `nist145-hybrid`, `63b-aal1`. Labels were not rewritten.

Parser/source cases (CS229 lecture pages, BERT smash, TraceMonkey smash, attention dropout page, …) stay silent. That is 4A.9.

## 14. All-126 development metrics

| Metric | 4A.7 frozen | 4A.8.1 |
|---|---|---|
| Spoken | 62 | 13 |
| Wrong-intent (machine-strict) | 68/126 (54%) | 4/126 (3.2%) |
| Genuine relevance wrong-intent | 60 | **0** |
| Unanswerable spoken | 20 | **0** |
| Answerable hit | 14/89 (16%) | 9/89 (10.1%) |
| False silence | 27/89 | 76/89 |
| Unsupported | 0 | 0 |
| Fabricated provenance | 0 | 0 |
| Page / location accuracy | 100% | 100% |

Strict-span hits among the 13 spoken Cards: the nine listed below. The other four are category I.

Hits: `cisa-smb`, `resnet-what`, `btc-coin`, `btc-incentive`, `tm-speedup`, `zta-what`, `zta-asset`, `omb-when`, `omb-passwords`.

## 15. Category-I: machine-strict vs human-acceptable

Frozen IDs (labels unchanged): `attn-arch`, `attn-bleu-de`, `resnet-error`, `tm-what`, `tm-name`, `nist145-counts`, `nist145-hybrid`, `63b-aal1`.

| ID | Machine-strict | Human relevance |
|---|---|---|
| attn-arch | spoke; frozen span miss | acceptable Transformer architecture claim |
| tm-what | spoke; frozen span miss | acceptable trace-based compilation claim |
| nist145-hybrid | spoke; frozen span miss | acceptable hybrid-cloud definition |
| 63b-aal1 | spoke; frozen span miss | acceptable AAL1 assurance claim |
| attn-bleu-de | silence | gold exists; coverage not recovered |
| resnet-error | silence | gold exists; coverage not recovered |
| tm-name | silence | gold exists; coverage not recovered |
| nist145-counts | silence | gold exists; coverage not recovered |

Provenance matching was not loosened. Evidence mapping remains exact.

Human-relevance wrong-intent on this corpus: **0**. Machine-strict leftover: the four spoke-I rows above.

## 16. Code baseline

`node --experimental-strip-types scripts/phase35-compare.ts`

```
northstarChipDiffs: []
cardDiffs: []
retrievalDiffs: []
ok: true
```

Code/TextEvidence path was not rolled onto QuestionContract.

## 17. Performance

No network, model, or embeddings.

| Step | Mean |
|---|---|
| Contract construction | 0.13 ms |
| Claim admission | 0.009 ms |
| Full document Card (warm-ish corpus walk) | ~71 ms |
| 4A.4 fixture Card | 0.99 ms |

Comfortably below UI latency. Not optimized further.

## 18. Remaining wrong-intent cases

**Genuine relevance: none.**

Machine-strict only — four frozen category-I span misses listed in §15. Understood. Not a ship-blocking relevance leak. Not a reason to start 4A.9.

---

## Other gates

- `npm test` — pass (includes new contract tests)
- `npm run lint` — 0 errors (pre-existing warnings only)
- `npm run typecheck` — pass
- `npm run build` — pass
- Frozen 4A.3 retrieval rank metrics unchanged (top1 5/6, top3 5/6, top6 6/6). Written to `.eval/phase4a/4a8.1/retrieval-bench.json`. Frozen `.eval/phase4a/retrieval-bench.json` not overwritten.
- Frozen 4A.4 Card bench re-run to `.eval/phase4a/4a8.1/card-bench.json`: wrong-intent **0**, unsupported **0**, page/location **100%**. Hit rate 17/22 (was 22/22). Five safe silences: `lecture-concurrent`, `multi-deadlock`, `paper-checks`, `bullets-list`, `slides-phantom`. Coverage not recovered.

Phase 4A.8.1 stops here. Do not begin Phase 4A.9.
