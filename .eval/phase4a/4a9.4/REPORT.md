# Phase 4A.9.4 — Block-aware production DocumentChunks

**Status:** implementation complete for this subphase only. **Recommend accept and freeze.** Phase 4A.9.5 was **not** started.

Landing stays **PDF · Coming soon**. Parser, `page.text`, readingOrder, layout classification, DocumentBlock reconstruction, QuestionContract, admission, source-selector, clause-completeness, relation-frame, evidence, currentness, word-level support, citations, viewer, and the code/TextEvidence path were not changed in this phase.

`PDF_PARSER_VERSION` stays **1**. `DOCUMENT_NORMALIZER_VERSION` stays **3**. `DOCUMENT_STRUCTURE_VERSION` stays **3**. Only `DOCUMENT_CHUNKER_VERSION` moved **1 → 2**.

Frozen floors compared, not overwritten: Phase 3.5, 4A.4.1, 4A.8.1, 4A.9.2, 4A.9.2.2, 4A.9.3.

---

## Decision

| Gate | Result |
|---|---|
| `DOCUMENT_CHUNKER_VERSION` | **2** |
| Production chunks consume safe mapped DocumentBlocks | **yes** |
| Furniture / unknown / pure math chunks | **0** |
| Synthetic non-contiguous list text | **0** |
| Every chunk `page.text.slice(start,end) === text` | **0** offset errors |
| Cross-gutter synthetic chunks | **0** |
| Table-to-prose searchable chunks | **0** |
| Partial cap truncation | **none** (refuse, not first-200) |
| Warm stored-chunk hydration | lazy; Blob **0**, PDF.js **0**, IR **0** |
| Phase 3.5 | `ok: true` |
| QuestionContract / admission edited | **no** |
| Unanswerable spoken | **0** |
| Unsupported / fabricated / wrong-source | **0** |
| Page / evidence-location | **100%** |
| Genuine relevance wrong-intent (human, all new speakers) | **0** |
| Controlled post-contract | **17/22** (unchanged) |
| Development spoken | **15 → 10** |
| Development answerable hit | **11/89 → 6/89** |

Machine-strict span misses remain 4/126: frozen `attn-arch` and `63b-aal1` (same say as 4A.9.2.2), plus `tm-nested` (**partial-but-valid**) and `zta-asset` (**acceptable alternate**, already a speaker). Those are not genuine wrong-intent.

---

## 1. Files changed

This phase only (chunker + ledger + tests + artifacts):

| File | Role |
|---|---|
| `src/lib/context/index-versions.ts` | `DOCUMENT_CHUNKER_VERSION` 1 → **2** |
| `src/lib/context/index-types.ts` | PDF ledger `structureVersion` |
| `src/lib/context/chunk-index.ts` | ledger requires structure + chunker versions; rebuild from IR |
| `src/lib/document/chunk.ts` | `buildDocumentChunks(document, structure?)` consumes mapped blocks |
| `src/lib/document/__tests__/chunk.test.ts` | isolated-lines without structure → 0 chunks |
| `src/lib/document/__tests__/chunk-4a94.test.ts` | paragraph / furniture / math / caption / list / table / offsets |
| `src/lib/context/__tests__/document-chunks.test.ts` | structure-mismatch + chunker-bump rebuild, no Blob/PDF.js |
| `src/lib/document/__tests__/blocks-4a93.test.ts` | expect chunker v2 |
| `src/lib/search/__tests__/document-card.test.ts` | `flatMap((d) => buildDocumentChunks(d))` TypeScript only |
| `src/lib/search/__tests__/question-contract.test.ts` | same `flatMap` wrapper; contract body untouched |
| `scripts/run-tests.mjs` | register `chunk-4a94.test.ts` |
| `scripts/pdf-4a9.4-mappability.ts` | pre-implementation block audit |
| `scripts/pdf-4a9.4-chunks.ts` | production chunk measurement |

Not changed: `question-contract.ts`, `document-card.ts` admission, `document-identity.ts`, `thread.ts`, `retrieve.ts`, `normalize.ts`, `layout.ts`, `blocks.ts` reconstruction, parser, landing Coming soon.

Not overwritten: `.eval/phase4a/4a9.3/`, `4a9.2.2/`, `4a9.2/`, `4a8.1/`, `release/`, `.eval/phase35/`.

---

## 2. DOCUMENT_CHUNKER_VERSION

**1 → 2.**

Expected invalidation: valid Blob + NormalizedDocument v3 + DocumentStructure v3 + old chunker v1 → rebuild **DocumentChunks only**. No PDF.js. No Blob load if IR is present.

Proved in unit tests (`document chunker version bump rebuilds from IR without Blob or PDF.js`, `structure version mismatch rebuilds chunks from NormalizedDocument without Blob or PDF.js`) and in the representative cache bench.

---

## 3. Pre-implementation block mappability audit

Source: `.eval/phase4a/4a9.4/block-mappability.json` (taken before `buildDocumentChunks` changed).

Valid = trustworthy contiguous `page.text` range. Invalid/partial = 0 corpus-wide. Missing = no `normStart`/`normEnd`.

| kind | total | valid | missing |
|---|---|---|---|
| paragraph | 2563 | **2240** | 323 |
| list | 204 | **198** | 6 |
| list-item | 319 | **311** | 8 |
| caption | 89 | **62** | 27 |
| heading | 250 | 193 | 57 |
| math | 138 | 28 | 110 |
| furniture | 239 | 45 | 194 |
| unknown | 2181 | 763 | 1418 |

Focus PDFs (valid / total paragraphs unless noted):

- CS229: 9/141 paragraphs mapped; 0/84 math mapped; 27 skipped pages; **0** skipped pages with mapped searchable blocks
- Attention: 81/112 paragraphs; 6 skipped pages; 0 skipped-with-mapped-searchable
- BERT: 196/196 paragraphs
- ResNet / TraceMonkey: all sampled paragraphs mapped
- 63B / CISA: lists mostly mapped (198/204 lists corpus-wide)
- NIST 207/63B: furniture marked; many furniture ranges still missing (194/239)

**Invariant kept:** a block without a contiguous mapped `page.text` range does not emit a production chunk. No item-reconstructed text. No block-local offsets.

---

## 4. Final searchable block policy

| kind | production |
|---|---|
| paragraph | one chunk if ≤1200 chars; else sentence → whitespace → hard cut |
| list | coherent parent range, or member-boundary groups ≤1200 |
| list-item | only if the parent cannot form a safe mapped chunk |
| caption | one chunk when independently understandable (≥3 words, ≥16 chars) |
| heading | metadata only; no heading-only chunks |
| math | **0** searchable chunks |
| furniture | **0** |
| unknown | **0** |
| table-derived | **0** prose chunks; captions only |

Unassigned / isolated-line material is **not** a searchable fallback on a page that has structure.

Exception (generic, not coverage-driven): if a page has **no blocks at all** and its accepted 4A.9.2 index is `full`, the newline/column paragraph path is kept (this is how the two-column `paper.pdf` fixture still chunks). Isolated-lines without blocks → silence.

Furniture text that leaks into a paragraph's mapped slice is **subtracted** as an exact `page.text` subrange. The banner stays in `page.text` / viewer / raw items.

---

## 5. Paragraph chunk behavior

A mapped paragraph normally emits one chunk at ≤1200 normalized chars. Larger paragraphs split on sentence boundaries, then safe whitespace, then a hard cut. No overlap. Splits keep exact page offsets. Blocks are never merged merely to fill a target size.

---

## 6. List chunk behavior

Lists measured:

| fate | count |
|---|---|
| parent-contiguous | **195** |
| member-groups | **3** |
| item-only fallback | **0** |
| completely unsearchable | **6** |

No synthetic concatenation of non-contiguous member ranges. Heading text is not copied into later groups unless it is physically inside that range.

CISA `cisa-smb` still speaks a coherent mapped bullet. QuestionContract enumeration is unchanged; `bullets-list` remains silent (17/22 cost). List success is not claimed from retrieval alone.

---

## 7. Caption behavior

Mapped meaningful captions emit one chunk. Axis ticks, detached labels, and table cells do not. A caption chunk does not grant figure/table values.

---

## 8. Heading behavior

Headings are `DocumentChunk.heading` metadata (outline or a nearby mapped heading). Heading text is not injected into `chunk.text`. No heading-only retrieval hits.

---

## 9. Math behavior

Pure symbolic/math blocks emit **0** chunks. Math-adjacent prose that already exists as a mapped paragraph is searchable through that paragraph. No formula verbalization.

CS229 recovery is only the **9** mapped paragraphs. The 84 math blocks have no valid `page.text` range.

---

## 10. Furniture / unknown behavior

Furniture → 0 chunks. Unknown → 0 chunks.

The known NIST body-band line (`This publication is available free of charge from: …`) is absent from storedChunks (`furnitureOnlyChunks: 0`) and still present in `page.text`. Test: `NIST banner substring is stripped from a mixed paragraph slice`.

---

## 11. CS229 mappability outcome

| | |
|---|---|
| Paragraph blocks | 141 |
| Paragraphs with valid `page.text` ranges | **9** |
| Math blocks | 84 |
| Math with valid ranges | **0** |
| Skipped pages | **27** |
| Skipped pages that can emit safe block chunks without changing `page.text` | **0** |
| Production chunks | **9** (was 30) |

**27 skipped pages still cannot produce mapped chunks.** Those pages have no usable `NormalizedPage.text` / source segments for the reconstructed items. Recovering them requires a normalizer/`page.text` change. That is a 4A.9.5 / next-normalization issue, not forced here.

---

## 12. Cache / invalidation

PDF document chunk ledger now requires:

`contentHash` + `PDF_PARSER_VERSION` + `DOCUMENT_NORMALIZER_VERSION` + `DOCUMENT_STRUCTURE_VERSION` + `DOCUMENT_CHUNKER_VERSION` + `RETRIEVAL_INDEX_VERSION` + valid stored count.

| event | Blob | PDF.js | IR | chunks |
|---|---|---|---|---|
| warm v2 hit | 0 | 0 | 0 | restore `storedChunks` |
| chunker v1 vs v2 | 0 | 0 | load NormalizedDocument | rebuild |
| structure version mismatch | 0 | 0 | load NormalizedDocument → derive structure | rebuild |

v2/v3 structure cannot satisfy a chunker that expects a different structure semantic. Phase 3 lazy architecture is preserved.

---

## 13. Before / after corpus chunks

| | |
|---|---|
| Before (4A.9.2 / 4A.9.3 production) | **7,917** |
| After | **2,781** |
| Reduction | **64.9%** |
| Isolated-line-origin chunks remaining | **0** |

---

## 14. Per-PDF chunk counts

| PDF | before | after | reduction | over 200 |
|---|---|---|---|---|
| attention.pdf | 304 | 93 | 69.4% | no |
| bert.pdf | 325 | 209 | 35.7% | **yes** |
| bitcoin.pdf | 227 | 80 | 64.8% | no |
| cisa-ransomware.pdf | 922 | 275 | 70.2% | **yes** |
| cs229-notes.pdf | 30 | 9 | 70.0% | no |
| lora.pdf | 529 | 127 | 76.0% | no |
| nist-800-145.pdf | 138 | 50 | 63.8% | no |
| nist-800-207.pdf | 1200 | 567 | 52.8% | **yes** |
| nist-800-63b.pdf | 2104 | 715 | 66.0% | **yes** |
| omb-m22-09.pdf | 689 | 381 | 44.7% | **yes** |
| resnet.pdf | 804 | 137 | 83.0% | no |
| tracemonkey.pdf | 645 | 138 | 78.6% | no |

Unreadable / scanned / refused PDFs stay at 0.

---

## 15. 200/PDF failures

Still over the frozen 200 cap (honest refuse, not truncate):

- `bert.pdf` 209
- `cisa-ransomware.pdf` 275
- `nist-800-207.pdf` 567
- `nist-800-63b.pdf` 715
- `omb-m22-09.pdf` 381

Caps were **not** raised.

---

## 16. 800/Context implications

Largest-five **projected** sum (including PDFs that production refuses): **2,147 > 800**.

Those five never enter a Context under current semantics.

Indexable-under-200 ready set:

`attention + bitcoin + cs229 + lora + nist-145 + resnet + tracemonkey` = **634 < 800**.

Realistic 5–7 PDF Contexts from that set stay under 800. Adding any of the five over-200 PDFs is an honest refusal at PDF index time, not a silent partial Context.

4A.9.5 should reassess whether 200/800 still match block-aware measurements. Not this phase.

---

## 17. Retrieval metrics

Weights were not tuned. Ordering vs 4A.3 is not required to match.

Development 126 (answerable 89, path#page vs retrievePaths):

| | 4A.9.2.2 | 4A.9.4 |
|---|---|---|
| Top-1 | 41/89 | **31/89** |
| Top-3 | 46/89 | **38/89** |
| Top-6 | 49/89 | **40/89** |

Controlled fixture retrieval: Top-1 **5/6**, Top-3 **5/6**, Top-6 **6/6** (unchanged vs 4A.9.2).

The drop is from dropping isolated-line / unknown fragments, not from weight changes.

---

## 18. Controlled 17/22 before / after

**17/22 → 17/22.** No admission changes.

These five remain silent. No new block chunk independently passed the frozen contract for them:

| id | what would have been needed |
|---|---|
| `lecture-concurrent` | no new admitted span |
| `multi-deadlock` | no new admitted span |
| `paper-checks` | no new admitted span |
| `bullets-list` | coherent list exists; contract still rejects |
| `slides-phantom` | no new admitted span |

---

## 19. All-126 Card metrics

| | 4A.9.2.2 | 4A.9.4 |
|---|---|---|
| Spoken | 15 | **10** |
| Answerable hit | 11/89 | **6/89** |
| False silence | 74/89 | 79/89 |
| Unanswerable spoken | 0 | **0** |
| Unsupported | 0 | **0** |
| Fabricated provenance | 0 | **0** |
| Page / location | 100% | **100%** |
| Machine-strict wrong-intent | 4/126 | 4/126 |
| Genuine relevance wrong-intent | 0 | **0** |

Spoken now: `cisa-smb`, `attn-arch`, `bert-glue`, `btc-coin`, `btc-incentive`, `tm-nested`, `zta-asset`, `omb-when`, `omb-passwords`, `63b-aal1`.

Lost: `bert-nsp`, `resnet-what`, `resnet-degrade`, `tm-what`, `tm-speedup`, `nist145-hybrid`, `zta-what`. Coverage loss is accepted. Isolated-line retrieval was not restored to keep those Cards.

---

## 20. Newly spoken Cards + human adjudication

Two new speakers vs 4A.9.2.2. Both reviewed. **Genuine wrong-intent = 0.**

| id | say | adjudication |
|---|---|---|
| `bert-glue` | `…pushing the GLUE score to 80.5%…` | **exact gold** |
| `tm-nested` | `On ever tracing outer loops. We solve the nested loop problem by recording` | **partial-but-valid** |

`tm-nested` is the start of the gold sentence (`recording nested trace trees`). A cap/sentence split cut the chunk after `recording`. The prefix is the previous sentence tail on the same mapped paragraph. Intent is the nested-loop solution.

`zta-asset` is **not** new. Say changed from exact gold `No asset is inherently trusted.` to the numbered tenet `No resource is inherently trusted…` — **acceptable alternate**. Machine span miss only.

Details: `.eval/phase4a/4a9.4/new-speakers.json`, `safety-adjudication.json`.

---

## 21. Mixed-context result

Code question → TextEvidence (`RETRIES` / retry.ts).  
PDF question → DocumentEvidence (serializable isolation).  
Shared vocabulary (`isolation`) → frozen QuestionContract still decides; no source-type bonus.

`pass: true`. Artifact: `mixed-context.json`.

---

## 22. Performance

No optimization. Representative IR derive + chunk (already-parsed NormalizedDocument, PDF.js 0):

| PDF | structure ms | chunk ms |
|---|---|---|
| BERT | 86 | 0.6 |
| Attention | 41 | 1.1 |
| CS229 | 83 | 0.1 |
| 63B | 107 | 2.6 |
| CISA | 52 | 0.5 |
| NIST 207 | 67 | 2.7 |

Warm `indexContext` after v2 persist: Blob **0**, IR **0**, PDF.js **0**, ~0.02–0.4 ms.

BERT / CISA / 63B / NIST 207 warm-restore **0 stored chunks** because production refuses them at the 200 cap. Attention (93) and CS229 (9) restore storedChunks.

---

## 23. Phase 3.5 comparison

`node --experimental-strip-types scripts/phase35-compare.ts` → `{ "ok": true }`

northstarChipDiffs / cardDiffs / retrievalDiffs empty. Code/TextEvidence path unchanged.

---

## 24. Tests / build / lint / typecheck

| gate | result |
|---|---|
| `npm test` | pass |
| `npm run lint` | pass (0 errors; 8 pre-existing warnings, none in this phase) |
| `npm run typecheck` | pass |
| `npm run build` | pass |

Added tests: mapped paragraph; large paragraph splits; furniture → 0; unknown → 0; math → 0; caption; small list; large list member groups; non-contiguous list no concat; offsets; pages; two-column/gutter; table → 0 prose; chunker v1 invalid for v2; warm restore without IR/Blob/PDF.js; structure mismatch rebuild; >200 refuse not truncate; NIST banner absent from chunks.

---

## 25. Remaining structural / chunk failures

- Five real PDFs still **>200** after block-aware chunking.
- CS229: 27 skipped pages remain unsearchable without a `page.text` change.
- Attention: 6 skipped pages; 31 unmapped paragraphs; no cross-gutter resurrection.
- 6 lists completely unsearchable (unmapped parent).
- 323 unmapped paragraphs stay silent.
- Coverage dropped (spoken 15→10, Top-k down) because isolated-line / unknown fallback is gone.
- `tm-nested` gold object (`nested trace trees`) sits in the next split — a later chunker polish, not a contract patch.

---

## 26. Recommendation for 4A.9.5

**Accept and freeze 4A.9.4.** Do not start 4A.9.5 in this turn.

4A.9.5 should, if opened later:

1. Reassess the frozen **200/PDF** and **800/Context** caps against these measurements. Do not raise them just to keep BERT/CISA/NIST.
2. Treat CS229 skipped-page recovery as a **normalization / mapping** problem, not a chunker workaround.
3. Leave QuestionContract frozen. Do not special-case `tm-nested`, CISA, or 63B.
4. Optionally tighten paragraph splits so gold objects are not cut off mid-sentence after `recording`.
5. Keep furniture/unknown/math silent.

---

## Artifacts

All under `.eval/phase4a/4a9.4/`:

`block-mappability.json`, `chunk-before-after.json`, `chunks-by-document.json`, `block-coverage.json`, `budget-results.json`, `retrieval-run.json`, `retrieval-controlled.json`, `card-run.json`, `new-speakers.json`, `safety-adjudication.json`, `controlled-card-bench.json`, `mixed-context.json`, `cache-bench.json`, `REPORT.md`.
