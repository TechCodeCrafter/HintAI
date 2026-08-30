# Phase 4A.9.2 — Dominant prose regions + grid-vs-math + cross-gutter safety

**Status:** implementation of the frozen 4A.9 design, this subphase only. Phase 4A.9.3 was not started.

Landing stays **PDF · Coming soon**. QuestionContract, admission, retrieve weights, IDF formulas, MAX_PER_FILE, evidence semantics, citations, and viewer highlight logic were not changed.

Frozen floors compared: Phase 3.5, 4A.4.1 (22/22 pre-contract), 4A.8.1 (unanswerable spoken 0, unsupported 0, fabricated 0, page/location 100%, controlled 17/22), 4A.9.1 diagnostics.

---

## 1. Files changed

| File | Role |
|---|---|
| `src/lib/context/index-versions.ts` | `DOCUMENT_NORMALIZER_VERSION` 2 → **3**; `DOCUMENT_STRUCTURE_VERSION` 1 → **2** |
| `src/lib/document/pdf/layout-geometry.ts` | shared visual-line / left-edge / dense-grid primitives |
| `src/lib/document/pdf/prose-regions.ts` | production prose-mass, dominant regions, grid-vs-math, width-distrust |
| `src/lib/document/pdf/layout.ts` | `detectReadingOrder` consumes dominant-prose analysis |
| `src/lib/document/pdf/normalize.ts` | skip table-like grids; skip uncertain math pages; region-split lines |
| `src/lib/document/structure.ts` | diagnostic fields for production analysis |
| `src/lib/document/structure-diagnostics.ts` | same analysis as production |
| `src/lib/document/pdf/__tests__/layout-4a92.test.ts` | new structural tests |
| `src/lib/document/__tests__/structure.test.ts` | updated for production consumption |
| `scripts/pdf-4a9.2-layout.ts` | corpus audit → `.eval/phase4a/4a9.2/` |
| `scripts/pdf-4a8.1-gate.ts` | optional `--out=` (default still 4A.8.1) |
| `scripts/run-tests.mjs` | register new tests |

Not changed: `question-contract.ts`, `retrieve.ts`, `chunk.ts` rules, `parse.ts` extract, landing Coming soon.

Not overwritten: `.eval/phase4a/4a9.1/`, `.eval/phase4a/4a8.1/`, `.eval/phase4a/4a9/`, `.eval/phase4a/release/`, `.eval/phase35/`.

---

## 2. DOCUMENT_NORMALIZER_VERSION

**2 → 3.**

`page.text`, reading order, and index mode can change. Stale NormalizedDocument rows with version 2 are uncurrent. Rebuild is from stored `page.items` when the cache has them; otherwise from the Blob / PDF.js as the current architecture already requires. This phase does not fake compatibility.

`DOCUMENT_STRUCTURE_VERSION` is **2** because production now consumes the same region analysis and diagnostic fields were added. Structure remains derived and is still not on warm hydration.

`PDF_PARSER_VERSION` stays **1**.

---

## 3. Dominant-prose-region algorithm

1. Geometric `isDenseGrid` still runs. `classifyGridKind` then labels **table** vs **math**. Tables skip. Math does not automatically become a table.
2. Cluster **prose items** (≥2 words with a 3+ letter token, or `str.length ≥ 24`) by **left-edge origin**, not `itemRight`.
3. Rank clusters by alphabetic **prose mass**.
4. High-confidence two-column when the top two clusters:
   - each have ≥3 items, ≥40 alphabetic chars, ≥2 multi-word lines
   - each hold ≥18% of page prose mass
   - are separated by ≥ max(56pt, 18% width) and straddle mid
   - have overlapping y-spans (≥30% of the shorter)
   - together hold ≥55% of prose mass
   - the page is not a table
5. Extra leftover clusters (title, indent, caption) do not veto the pair. They are assigned by **itemX vs splitX** only. No third reading sequence.
6. `refuseSingleColumn` when tight cross-gutter risk is present. That path is **uncertain**, never two-column from a mid-page split alone.
7. The old exact-2 `twoColumnPair` remains as a conservative fallback for clean fixtures (`paper.pdf`).

---

## 4. Prose-mass definition

`itemProseMass(item) = count of [A-Za-z] in item.str`.

Overflowing PDF.js width cannot dominate. Column identity uses `itemX` only.

---

## 5. Extra-cluster handling

Minor clusters stay out of the dominant pair. Assignment is nearest body side only when `itemX` is on that side of `splitX`. Full-width titles that start on the left stay left.

---

## 6. Attention width-distrust

`itemOverflowsMid`: `itemX < mid` and `itemRight > mid + 20` and `width > 45%` of page width.

Those items stay in the **left** region. Their reported right edge never pulls a right-origin item onto the same visual line.

---

## 7. Cross-gutter hard rule

Once a split exists, left-origin and right-origin items are grouped separately.

Invariant (tested): items assigned to different dominant regions never share a `VisualLine`, so they never share a same-line inserted space.

Tight cross-gutter (production): two multi-word items straddling mid on one y-group, **or** overflow width plus a second item originating past mid. Broader 4A.9.1 overflow-only noise is not enough.

If that flag fires without two dominant regions → **uncertain**, never single-column.

Corpus: **0** cross-gutter joins. **0** Attention false single-column.

---

## 8. BERT results

**16 / 16** pages `two-column` / `full`.

Previously 16 uncertain, 14 isolated-lines. Extra left-edge clusters no longer veto the two body columns.

Chunks **781 → 325**.

---

## 9. ResNet results

**11 / 12** `two-column`. Page 4 stays conservative `uncertain`.

Previously 12 uncertain. Recovered 2 formerly skipped figure-adjacent pages as two-column (not flattened tables).

---

## 10. TraceMonkey results

**13 / 14** `two-column`. Page 3 conservative `uncertain`.

`tm-what` is now a **span hit** (was 4A.8.1 category-I leftover).

---

## 11. CS229 grid-vs-math

| | 4A.9.1 | 4A.9.2 |
|---|---:|---:|
| skipped | 27 / 28 | **27 / 28** |
| classified `math` then skipped as uncertain | — | 24 |
| classified `table` and skipped | — | 3 (pages 1, 9, 26) |
| indexed | 1 (p14 isolated) | 1 (p14) |

The detector now **distinguishes** lecture math from a lattice. Production still refuses to index uncertain math pages.

A trial that forced math → single-column recovered those 24 pages but:

- classified some Attention body pages as math → **false single-column returned**
- created **50** cross-gutter joins
- made `tm-name` cite CS229 Fisher scoring (wrong source)

That path was **reverted**. 4A.9.3 should reconstruct math pages inside one region, not stream them.

---

## 12. Table regression

Controlled dense-grid fixtures stay `skipped` / empty text.

Corpus `tableFlattened`: **0**.

Real tables remain skipped. Figure pages that look like math stay skipped when reading order is uncertain.

---

## 13. Mapping / provenance

- `mappingErrorCount`: **0** on the ready corpus
- `assertMappedCoverage` on all changed fixtures
- Cards still cite `itemRanges`, never a region/block id
- `documentIsCurrent` rejects normalizer version 2

---

## 14. Page classifications

| | 4A.9.1 | 4A.9.2 |
|---|---:|---:|
| ready pages | 326 | 326 |
| uncertain | 242 | **222** |
| single-column | 70 | **41** |
| two-column | 14 | **63** |
| isolated-lines | 187 | **174** |
| skipped | 55 | **48** |
| full | 84 | **104** |

Attention: 6 former false `single-column` / `full` pages are now `uncertain`. Safer.

NIST 207 two-column 5 → 5. 63B 5 → 10 (some additional dominant pairs). CISA 0 → 4.

---

## 15. Chunk counts

Chunker rules unchanged. Counts moved because `page.text` / readingOrder changed.

| | 4A.9.1 | 4A.9.2 |
|---|---:|---:|
| uncapped total | 7,616 | **7,917** |
| isolated-line share (page index) | 6,536 / 7,616 | 5,573 / 7,917 |
| PDFs >200 | 8 | 10 |
| largest-5 sum | 5,686 | 5,719 |
| Context cap | 800 | 800 |

BERT −58% chunks is the two-column win. Attention / LoRA / ResNet rose because safer uncertain pages emit isolated lines instead of one smashed stream. Do not raise 200/800. 4A.9.3/4 own block chunks.

---

## 16. 126 development safety

| | 4A.8.1 | 4A.9.2 |
|---|---:|---:|
| unanswerable spoken | **0** | **0** |
| unsupported | **0** | **0** |
| fabricated provenance | **0** | **0** |
| page / location | **100%** | **100%** |
| wrong-source spoken | **0** | **0** |
| machine-strict span miss | 4/126 (all category I) | 6/126 |
| answerable hit | 9/89 | **11/89** |

Frozen category I leftovers still speaking: `attn-arch`, `nist145-hybrid`, `63b-aal1`.

`tm-what` is now a **gold-span hit** (TraceMonkey two-column page 1).

Three **new correct-source gold-span misses** after two-column pages became `full`. They passed the frozen QuestionContract independently. They do not cite the wrong PDF:

| id | cited | spoken vs gold |
|---|---|---|
| `bert-nsp` | bert.pdf | NSP setup sentence; gold is the 50% next-sentence rule |
| `lora-what` | lora.pdf | “freeze the MLP modules” (a real ablation line); gold is freeze pretrained weights |
| `tm-base` | tracemonkey.pdf | interpreter / JIT sentence; gold names SpiderMonkey |

`lora-what` is the closest to a wrong-fact on the right paper. Admission was not loosened to create it. Do not tune the contract on these 126.

Wrong-source (`tm-name` → CS229) appeared only in the reverted math-stream trial.

---

## 17. Controlled 17/22

Post-contract controlled bench remains **17/22**. Wrong-intent 0. Same five silences. No QuestionContract change. None of the five were recovered.

4A.4.1 pre-contract 22/22 file was not overwritten.

---

## 18. Baseline comparisons

| Baseline | Result |
|---|---|
| Phase 3.5 `phase35-compare` | `ok: true` |
| 4A.4.1 `card-bench-4a41.json` | not overwritten |
| 4A.8.1 safety dir | not overwritten |
| Controlled post-contract | **17/22**, written only to `4a9.2/controlled-card-bench.json` |
| Retrieval fixture ranks | top1 **5/6**, top3 **5/6**, top6 **6/6** |
| Mapping errors | 0 |
| Cross-gutter joins | 0 |
| False Attention single-column | 0 |
| Tables flattened | 0 |
| `npm test` | 195 pass |
| `npm run lint` | 0 errors |
| `npm run typecheck` | pass |
| `npm run build` | pass |

---

## 19. Remaining layout failures

1. **Attention** still cannot see two dominant left-edge clusters on most body pages. Width-distrust prevents smash; it does not yet yield two-column. All 15 pages are uncertain. 4A.9.3 should assign regions from long-item origins after capping overflow width.
2. **CS229** is measurable as math, but uncertain math stays skipped (27/28). Streaming it as single-column reopened Attention smash and a wrong-source Card. Block reconstruction is required.
3. **ResNet page 4** and **TraceMonkey page 3** stay conservative uncertain.
4. **LoRA / Attention figure pages** that are `math` + uncertain stay skipped. Isolated crumbs were too noisy to index.
5. **Chunk count rose** (7,616 → 7,917). Isolated-line share is still the volume driver. Do not raise caps.
6. NIST body-band furniture is still not stripped (4A.9.3).
7. 63B / CISA lists are still one line per chunk (4A.9.3).

---

## 20. Recommendations for 4A.9.3

1. Reconstruct paragraphs / lists / captions **inside one region only**.
2. For Attention, cap trusted width from glyph estimate, then build two regions from long-item origins.
3. For CS229, build math blocks from visual lines inside a single region. Do not stream the page. Do not emit isolated equation crumbs.
4. Strip repeated NIST body-band furniture (any y, stable text).
5. Join list members with heading + indent. Do not invent cross-page lists.
6. Bump `DOCUMENT_CHUNKER_VERSION` only when chunks come from blocks.
7. Keep QuestionContract frozen. New claims may speak only if they independently pass it.
8. Do not raise 200 / 800.
9. Do not begin 4A.9.4 until block reconstruction is real.

---

## Acceptance

- False confident cross-gutter single-column eliminated on Attention
- BERT 16/16 and ResNet 11/12 body pages two-column; leftovers conservative uncertain
- Attention never creates cross-gutter synthetic prose (0 joins)
- Math-vs-grid is measurable; tables stay skipped; CS229 not streamed
- Mapping and provenance exact
- Unanswerable spoken 0; unsupported 0; fabricated 0; wrong-source 0
- QuestionContract unchanged
- Code / TextEvidence baseline unchanged (Phase 3.5 `ok: true`)
- 4A.9.3 not started
