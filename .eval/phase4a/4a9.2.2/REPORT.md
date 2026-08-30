# Phase 4A.9.2.2 — Relation scope + clause completeness

**Status:** safety patch accepted against the 4A.9.2.1 adjudication. Phase 4A.9.3 was **not** started. 4A.9.2 layout work is intact and **still not a freeze** of the representation itself; this phase only restores the relevance floor.

PDF landing stays **Coming soon**. No embeddings, LLM parsing, retrieval/IDF/caps, evidence, currentness, support, citations, or viewer changes.

---

## Decision

| Gate | Result |
|---|---|
| `lora-what` wrong claim | **SILENCE** |
| `tm-base` wrong claim | **SILENCE** |
| Genuine relevance wrong-intent | **0** |
| Unanswerable spoken | **0** |
| Unsupported / fabricated / wrong-source | **0** |
| Page / evidence-location | **100%** |
| 4A.8.1 speakers lost | **0** |
| Controlled post-contract | **17/22** (unchanged; not increased) |
| Phase 3.5 | `ok: true` |
| Parser / layout sources edited | **no** |

Machine-strict span misses remain 4/126: three frozen category I leftovers (`attn-arch`, `nist145-hybrid`, `63b-aal1`) plus `bert-nsp` (`PARTIAL_BUT_VALID`). Those are not genuine wrong-intent.

---

## 1. Files changed

| File | Role |
|---|---|
| `src/lib/search/question-contract.ts` | clause completeness, relation frame, relative-clause guard, which-entity naming |
| `src/lib/search/document-card.ts` | pass the retrieved chunk as admission context (not spoken text) |
| `src/lib/search/__tests__/question-contract.test.ts` | eight new regression tests |

Not changed: `src/lib/document/pdf/**`, `structure*`, `chunk.ts`, retrieve, IDF, evidence, landing.

Not overwritten: `.eval/phase4a/4a9.2/`, `4a8.1/`, `release/`, `.eval/phase35/`.

---

## 2. QuestionContract type changes

```ts
requiredRelation?: { verb: string; particle?: string; preposition?: string }
requestedEntityType?: string
answerExpectation includes "naming"
```

`requiredVerb` remains `requiredRelation.verb` for existing tests.

`claimFitsContract(claim, contract, containing?)` — optional `containing` is the same-chunk / same-page block. It is eligibility context only. Spoken text is not expanded.

---

## 3–5. Clause completeness / dependent conjunct / relation frame

A claim used to answer an action question is rejected when it is a **dependent coordinated tail**:

- starts with `and|but|or|nor|yet|so|then` and then the required verb with no local subject
- contains `and freeze …` (or the asked verb) with no subject between the coordinator and the verb
- starts with the required verb and has no clause subject (`freeze the MLP modules`)
- or is a suffix of the containing block after `and` whose earlier governing action is a different verb (`limit … and freeze`)

`And the controller stores the token in memory.` stays eligible: leading coordinator + explicit subject.

Self-contained `We freeze the pre-trained model weights.` stays eligible.

Relation frame: if the question supplies a complement, the bare verb is not enough.

| Question | Frame |
|---|---|
| Which interpreter did they implement on? | `implement` + `on` |
| Where is customer data stored? | `store` + `in` (aliases `at|inside|within|into`) |
| What does LoRA freeze? | `freeze` only |

`native code which implement the required bytecodes` does not satisfy `implement on`.

The source-selector token is **not** required in the claim. `We freeze the pre-trained model weights` remains valid LoRA evidence.

---

## 6. Relative-clause guard

If every occurrence of the required verb sits after `which|that|who`, it does not satisfy the main relation.

`The service stores customer data in Canada, which handles retries.` still passes `store`+`in` because `stores` is the main clause.

---

## 7. Naming expectation

`Which <entity-type> …` (not enumeration, not vendor-recommendation) sets:

- `answerExpectation = naming`
- `requestedEntityType` (e.g. `interpreter`)

The type word does not have to appear in the claim. A valid claim must place a **specific name in the asked relation** (`implemented … on SpiderMonkey`).

Name = CamelCase or letter+digit (`SpiderMonkey`, `V8`). Not sentence-initial capitals, not generic tokens (`interpreter`, `JIT`, `VM`, `bytecode`).

`We implemented the recorder on Inline.` is rejected (unrelated capitalized token, not a name-in-relation).

---

## 8–11. Focus cases

| id | 4A.9.2 | 4A.9.2.2 |
|---|---|---|
| `lora-what` | spoke MLP ablation tail | **SILENCE** — dependent conjunct |
| `tm-base` | spoke inline-threading / relative `implement` | **SILENCE** — not `implement on` + no named interpreter |
| `bert-nsp` | PARTIAL_BUT_VALID | **unchanged** (no procedure/extract change) |
| `resnet-degrade` | exact gold | **unchanged** |

---

## 12. Existing 4A.8.1 speakers

All 13 remain spoken. None were silenced.

`cisa-smb`, `attn-arch`, `resnet-what`, `btc-coin`, `btc-incentive`, `tm-what`, `tm-speedup`, `nist145-hybrid`, `zta-what`, `zta-asset`, `omb-when`, `omb-passwords`, `63b-aal1`.

---

## 13. Controlled benchmark

`.eval/phase4a/4a9.2.2/controlled-card-bench.json`

**17/22**. Wrong-intent 0. Same five silences. Did not increase (no admission loosening). Pre-contract 22/22 file was not overwritten.

---

## 14. All 126

| | 4A.8.1 | 4A.9.2 | 4A.9.2.2 |
|---|---:|---:|---:|
| spoken | 13 | 17 | **15** |
| unanswerable spoken | 0 | 0 | **0** |
| unsupported | 0 | 0 | **0** |
| fabricated | 0 | 0 | **0** |
| page / location | 100% | 100% | **100%** |
| wrong-source | 0 | 0 | **0** |
| genuine wrong-intent | 0 | 2 | **0** |
| machine-strict span miss | 4 | 6 | **4** |
| answerable hit | 9/89 | 11/89 | **11/89** |

Labels were not edited.

---

## 15. Parser / layout equality

No edits under `src/lib/document/pdf/`, `structure*`, or `chunk.ts`. The 4A.9.2 audit script was not re-run (it writes into `4a9.2/`).

Frozen 4A.9.2 numbers still hold as the representation:

- BERT 16/16 two-column
- ResNet 11/12
- TraceMonkey 13/14
- Attention cross-gutter joins 0; false single-column 0
- tables flattened 0
- CS229 conservative skip

Source SHA-256: `layout-equality.json`.

---

## 16. Phase 3.5

`node --experimental-strip-types scripts/phase35-compare.ts` → `{ "ok": true }`  
northstar / card / retrieval diffs empty.

---

## 17. Tests / build / lint / typecheck

| Gate | Result |
|---|---|
| `npm test` | pass (0 fail); 8 new contract tests |
| `npm run lint` | 0 errors (pre-existing warnings only) |
| `npm run typecheck` | pass |
| `npm run build` | pass |

---

## 18. Remaining genuine relevance failures

**None.**

Machine-strict leftovers (not this phase’s job):

- `attn-arch`, `nist145-hybrid`, `63b-aal1` — frozen category I
- `bert-nsp` — adjudicated `PARTIAL_BUT_VALID`; left spoken on purpose

4A.9.3 (block reconstruction) was not started.
