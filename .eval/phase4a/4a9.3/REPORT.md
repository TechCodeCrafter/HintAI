# Phase 4A.9.3 — Real DocumentBlock reconstruction

**Status:** implementation complete for this subphase only. Phase 4A.9.4 was **not** started.

Landing stays **PDF · Coming soon**. Production `buildDocumentChunks()`, stored chunk text, retrieve / IDF / MAX_PER_FILE, QuestionContract, admission, evidence, citations, viewer, and Add-files UX were not changed.

`DOCUMENT_NORMALIZER_VERSION` stays **3**. `PDF_PARSER_VERSION` stays **1**. `DOCUMENT_CHUNKER_VERSION` stays **1**. Only `DOCUMENT_STRUCTURE_VERSION` moved **2 → 3**.

Frozen floors compared, not overwritten: Phase 3.5, 4A.4.1, 4A.8.1, 4A.9.2, 4A.9.2.2.

---

## 1. Files changed

| File | Role |
|---|---|
| `src/lib/context/index-versions.ts` | `DOCUMENT_STRUCTURE_VERSION` 2 → **3** |
| `src/lib/document/blocks.ts` | reconstruction engine, trusted width, hypothetical projection |
| `src/lib/document/structure.ts` | derive fills real `blocks`; validators for IDs / ranges / overlap |
| `src/lib/document/evidence.ts` | comment: blocks are never provenance |
| `src/lib/search/evidence.ts` | `DocumentEvidence` comment: no `blockId` |
| `src/lib/document/__tests__/structure.test.ts` | blocks exist; chunks / `page.text` unchanged; version rebuild |
| `src/lib/document/__tests__/blocks-4a93.test.ts` | paragraph / list / caption / furniture / math / Attention / IDs |
| `scripts/run-tests.mjs` | register `blocks-4a93.test.ts` |
| `scripts/pdf-4a9.3-blocks.ts` | corpus audit → `.eval/phase4a/4a9.3/` |

Not changed: `chunk.ts`, `normalize.ts`, `layout.ts`, `prose-regions.ts`, `retrieve.ts`, `question-contract.ts`, `document-card.ts`, `document-identity.ts`, thread, landing Coming soon.

Not overwritten: `.eval/phase4a/4a9.2.2/`, `4a9.2/`, `4a9.1/`, `4a8.1/`, `4a9/`, `release/`, `.eval/phase35/`.

---

## 2. DOCUMENT_STRUCTURE_VERSION

**2 → 3.**

A stale structure row is not stored on warm hydration. Rebuild is `deriveDocumentStructure(valid NormalizedDocument)` → Blob **0**, PDF.js **0**. Proved in unit tests and on every ready corpus PDF (`pdfjsDuringDerive: 0`).

---

## 3. Final DocumentBlock model

```ts
type DocumentBlock = {
  id: string
  kind: "paragraph" | "heading" | "list" | "list-item" | "caption"
       | "math" | "furniture" | "prose" | "unknown"
  page: number
  regionId?: string
  lineIds: string[]
  itemIndexes: number[]
  normStart?: number
  normEnd?: number
  parentBlockId?: string
  confidence?: "high" | "medium" | "low"
}
```

`normStart` / `normEnd` are present only when the items have `MappedSegments`. Skipped CS229 pages still get geometry-backed blocks with real `itemIndexes`.

IDs: `${sourceId}:p${page}:block:${kind}:${ordinal}`. No UUIDs.

Leaf kinds do not overlap normalized ranges. A parent `list` may span its `list-item` children.

**Blocks are not evidence.** Cards still resolve normalized range → MappedSegments → `itemRanges`.

---

## 4. Paragraph reconstruction

Join consecutive lines only when all of:

- same assigned region (or same implicit page region)
- compatible left edge (≤10pt) or small continuation indent (≤22pt)
- vertical gap ≤ 1.65 × line height
- similar line height
- next line is not a list / caption / math boundary
- mapped ranges, when present, stay exclusive (no foreign source segment inside the span)

Stop at a larger gap, indentation change, list marker, heading, caption, math, region change, or furniture.

Prefer two safe paragraphs over one merge. Sentence punctuation is not used as a sole signal. No LLM / embeddings.

Block text is the existing `page.text` slice. Characters are not inserted or deleted.

---

## 5. List model + reconstruction

Parent `list` + child `list-item`. Markers: `•`, `-`, `–`, `*`, `1.`, `1)`, `(a)`, `(a.)`, and the existing diagnostic set.

Continuation lines stay in the same item when indented 6–44pt with a normal gap.

A preceding heading attaches only if same page, same walk, immediately above, colon-terminated, and mapped/geometry-supported. Outline metadata is not used.

Cross-page lists stay two lists.

---

## 6. Caption rules

`Figure` / `Fig.` / `Table` / `Tbl.` / `Algorithm` + a number, ≥2 words, length ≥10.

Axis labels, ticks, and one-word tokens are not captions. A caption is never table content.

---

## 7. Furniture rules

Mark `kind = "furniture"`. **Do not strip `page.text`.**

Threshold:

- never for 1–2 page repeats
- `share ≥ 0.5` and `pages ≥ 3`
- or a known hint (`available free of charge`, `NIST SP`, etc.) with **pinned y** (`ySpread < 12`) on **≥8 pages** — this is how the 63B / 207 body-band DOI line is caught when first/section pages depress share (27/80 and 19/59)
- a 3-page unstable-y fragment of the same sentence is **not** furniture

---

## 8. Math-block model

Local groups of equation-like lines (symbol ratio / short tokens / `=` `∑` `∫`). Split on a large gap or a prose line.

A math page may interleave paragraph and math. They stay separate types.

Dense `gridKind === "table"` pages emit only `unknown` / caption — never paragraph, list, or math.

Skipped pages are not streamed as one column.

---

## 9. Attention block results

15 pages. `readingOrder` remains **uncertain**. `page.text` was not reordered.

| pages | paragraphs | unknown | headings | captions | math | lists |
|---|---|---|---|---|---|---|
| 15 | 111 | 145 | 22 | 10 | 8 | 1 list / 3 items |

Hard gates: **cross-region blocks = 0**, **cross-gutter joins remain 0**, no forced `two-column`. Overflow widths use trusted width for grouping only; stored item geometry is unchanged.

Pages 2–3 build region-local headings/paragraphs/captions (`Figure 1: The Transformer…`). Isolated page numbers stay `unknown`. Some in-column paragraphs are long because isolated-line index does not give a clean column stream — they still do not cross the gutter.

---

## 10. CS229 block results

All 28 pages reported in `cs229-blocks.json`.

| | pages | notes |
|---|---|---|
| VisualLines | 28/28 | items remain even when `index = skipped` |
| paragraph | 145 | local prose, not a page stream |
| math | 49 | local groups; none is a whole-page block |
| list | 3 / 3 items | page 13 |
| caption | 0 | |
| furniture | 0 | |
| unknown | 612 | majority; valid |
| table-like (p1, p9, p26) | 3 | all `unknown`; **not** flattened to prose |

Pages stay `skipped` / `uncertain`. Projected searchable units from these pages: **10** (unmapped math/unknown contribute 0). Not made searchable.

---

## 11. BERT / ResNet / TraceMonkey

| file | paragraphs | lists | captions | unknown | production chunks |
|---|---|---|---|---|---|
| BERT (16p) | 195 | 5 / 5 | 8 | 29 | 325 |
| ResNet (12p) | 135 | 1 / 1 | 9 | 42 | 804 |
| TraceMonkey (14p) | 128 | 3 / 3 | 5 | 39 | 645 |

Audited pages 2–5 on each: no cross-column paragraph. BERT p2 keeps left/right region ids separate. Some wrapped sentences stay split (conservative). BERT contribution bullets are under-grouped (4 list-like lines → 1 list / 1 item on p2).

---

## 12. 63B / CISA list results

| file | visual list-like lines | list blocks | list-item blocks | unassigned list-like |
|---|---|---|---|---|
| NIST 800-63B | **150** | 55 | 102 | 48 |
| CISA | **135** | 48 | 84 | 51 |

Heavy pages:

- CISA p2: 10 list-like → 2 lists / 10 items (complete)
- CISA p30: 15 → 4 / 12 (3 leftover)
- CISA p10: 12 → 1 / 1 (TOC-style / wrapped bullets left unknown)
- 63B p37: 8 → 2 / 8 (complete)
- 63B p14: 11 → 0 / 0 (numbered requirement lines not aligned enough)

Coverage is conservative. Completeness is incomplete on hanging / TOC / wrapped official lists. That is preferred to inventing membership.

---

## 13. NIST furniture results

| file | furniture blocks | body-band DOI | header `NIST SP …` |
|---|---|---|---|
| 800-63B | 169 | 27 pages, y=564.48, share 0.338, **marked** | 76/80, **marked** |
| 800-207 | 70 | 19 pages, y=559.26, **marked** | 56/59, **marked** |
| 800-145 | 0 | line not repeated in this short PDF | — |

`page.text` still contains the banner. Production chunks still index it. 4A.9.4 should emit **zero** chunks from furniture blocks.

Title-page author lines on 207 p2 were **not** marked furniture.

---

## 14. Structural audit metrics

Audited set: BERT 4, ResNet 4, TM 4, Attention 2/3 + 7/10/11, CS229 10, 63B 4 list-heavy, CISA 4 list-heavy, NIST 145/207 furniture + prose pages.

Counts, not inflated percentages:

| check | audited observation |
|---|---|
| Paragraph precision | No cross-column merge on BERT/ResNet/TM audited pages. Some mid-sentence splits (false split, not false merge). Attention in-column groups can be long. |
| List precision | Sampled CISA p2 and 63B p37 member texts are real bullets. No fabricated category names. |
| List-member completeness | 63B 102/150; CISA 84/135 assigned. Unassigned left `unknown`. |
| Caption precision | Attention `Figure 1`, BERT `Figure 1`/`Figure 2` correct. Axis ticks not captioned. |
| Furniture precision | Repeated headers + pinned DOI banner marked. Unique title-page lines not marked. **0** audited unique prose lines wrongly furniture. |
| Math-block precision | CS229 groups are local (1–7 math blocks/page, never 1×page). Some fragments (`given.)`) over-tagged; they stay small. |
| Cross-region merge | **0** |
| Table-to-prose | **0** |
| Mapping errors | **0** |

---

## 15. Mapping / provenance

- `mappingErrors` on every ready page: **0**
- `structureErrors`: **0**
- invalid `itemIndexes`: **0**
- source reconstruction / `DocumentEvidence`: unchanged; **no `blockId`**
- trusted width is grouping-only:

```
glyphEstimate = str.length * max(height, 8) * 0.52
trustedWidth  = min(reportedWidth, max(glyphEstimate, 8), medianClusterWidth * 1.35)
trustedRight  = itemX + trustedWidth
```

Raw `PdfTextItem.width` / `transform` are stored exactly.

---

## 16. Production chunk equality

`DOCUMENT_CHUNKER_VERSION = 1`.

Corpus uncapped chunks: **7,917 = 7,917** (per-file match vs accepted 4A.9.2 `chunk-impact.json`).

---

## 17. Card / retrieval equality

Vs accepted 4A.9.2.2 `card-run.json`:

- row diffs: **0** (spoke / say / cite / retrievePaths)
- `lora-what` → **SILENCE**
- `tm-base` → **SILENCE**
- `bert-nsp` unchanged (partial-but-valid)
- `resnet-degrade` unchanged (exact gold)
- spoken **15/126**
- genuine relevance wrong-intent **0** (machine-strict leftovers remain the same 4 IDs)
- unanswerable spoken **0**
- controlled post-contract **17/22**
- development answerable hit **11/89**

Retrieval paths identical because chunks are identical.

---

## 18. Projected future chunk counts

Diagnostic only. Furniture / unknown / unmapped math → 0. Not stored.

| | count |
|---|---|
| Production today | 7,917 |
| Hypothetical block units | **2,528** |
| PDFs that would still exceed 200 | 5 (BERT 208, CISA 276, 207 427, 63B 638, OMB 377) |
| Largest 5-PDF sum | 1,906 |
| Context cap | **800 unchanged** |
| Per-PDF cap | **200 unchanged** |

No 3,000 target was enforced. 4A.9.5 owns budget reassessment.

---

## 19. Structure-build timings

From an already-loaded `NormalizedDocument` (second `deriveDocumentStructure`):

| PDF | pages | total derive | second derive |
|---|---|---|---|
| BERT | 16 | 103 ms | 70 ms |
| Attention | 15 | 43 ms | 35 ms |
| CS229 | 28 | 77 ms | 76 ms |
| 63B | 80 | 111 ms | 102 ms |
| CISA | 31 | 46 ms | 49 ms |
| NIST 145 | 7 | 6 ms | 5 ms |

Structure-version mismatch rebuild: NormalizedDocument → structure v3, **PDF.js 0**, **Blob 0**.

---

## 20. Baseline comparisons

| Baseline | Result |
|---|---|
| Phase 3.5 | `ok: true` (chip / Card / retrieval diffs empty) |
| 4A.4.1 pre-contract | still 22/22 capability; post-contract controlled **17/22** |
| 4A.8.1 | unanswerable spoken 0, unsupported 0, fabricated 0, page/location 100% |
| 4A.9.2 layout | BERT 16/16 two-column, ResNet 11/12, TM 13/14, Attention false single-column 0, cross-gutter 0, tables flattened 0 — **unchanged** (normalizer not edited) |
| 4A.9.2.2 Cards | **byte-identical** |

`npm test`, `npm run lint` (0 errors), `npm run typecheck`, `npm run build` passed.

---

## 21. Remaining structural failures

1. **List completeness** — 193/524 list-like lines unassigned (63B hanging numbers, CISA TOC / wrapped bullets, BERT contribution markers).
2. **CS229 unknown mass** — 612 unknown lines; many are equation fragments that should stay unknown until a tighter local group is safe.
3. **Attention** — still no safe `readingOrder = two-column`; in-column paragraphs can be long; headings on isolated pages are often unmapped.
4. **Over-split paragraphs** — BERT/ResNet wrapped sentences sometimes become two blocks.
5. **NIST 145** — no repeated body-band line to mark; nothing to do.
6. **Furniture still searchable** — by design in this phase.

None of these leaked into production chunks or Cards.

---

## 22. Recommendations for 4A.9.4

1. Make `buildDocumentChunks()` consume `DocumentBlock` and bump **`DOCUMENT_CHUNKER_VERSION`**.
2. Furniture → **zero** searchable chunks; do not rewrite `page.text` unless a later phase needs it.
3. Unknown → zero or isolated diagnostic only.
4. Math → skip unless a mapped prose-bearing unit exists.
5. List → one coherent unit when under the future size cap; otherwise deterministic member groups.
6. Keep the cross-gutter / cross-page / table-flatten hard rules.
7. Do **not** raise 200/800 here. Reassess in 4A.9.5 after real block chunks exist.
8. Do **not** force Attention `readingOrder = two-column` as a side effect of chunking.
9. Do **not** stream CS229 as a single-column page.

---

**Phase 4A.9.4 was not started.**
