# Phase 4A.9.1 — Structural IR + diagnostic foundation

**Status:** accepted implementation of the frozen 4A.9 design, this subphase only. No 4A.9.2 work.

Landing stays **PDF · Coming soon**. QuestionContract, page.text, readingOrder, index mode, chunks, retrieve, and Cards are unchanged.

Frozen floors compared: Phase 3.5, 4A.4.1 (22/22 pre-contract), 4A.8.1 (genuine wrong-intent 0, unanswerable 0, 9/89, controlled 17/22).

---

## 1. Files changed

| File | Role |
|---|---|
| `src/lib/context/index-versions.ts` | `DOCUMENT_STRUCTURE_VERSION = 1` |
| `src/lib/document/structure.ts` | types, derive, validators, IDs |
| `src/lib/document/structure-diagnostics.ts` | features, regions, gutter, grid/math, lists, captions |
| `src/lib/document/evidence.ts` | comment: blocks are never provenance |
| `src/lib/document/__tests__/structure.test.ts` | IR / diagnostic / identity tests |
| `scripts/run-tests.mjs` | register structure tests |
| `scripts/pdf-4a9.1-structure.ts` | corpus diagnostics → `.eval/phase4a/4a9.1/` |

Not changed: `normalize.ts`, `layout.ts`, `chunk.ts`, `parse.ts`, `question-contract.ts`, retrieve, landing, Dexie hydration.

Not overwritten: `.eval/phase4a/4a9/`, `.eval/phase4a/4a8.1/`, `.eval/phase4a/release/`, `.eval/phase35/`.

---

## 2. Final structural types

`DocumentStructure` is a derived snapshot of an existing `NormalizedDocument`.

```
DocumentStructure
  sourceId, contentHash
  parserVersion, normalizerVersion, structureVersion
  pages: StructuredPage[]
  furnitureCandidates[]          // diagnostic
```

`NormalizedPage`, `MappedSegment`, and `PdfTextItem` are unchanged.

---

## 3. VisualLine model

`StructureVisualLine` (separate from layout.ts’s internal `VisualLine`):

- `id`, `ordinal`, `itemIndexes` (raw PDF.js indexes)
- optional `normStart` / `normEnd` when the line contributed source segments
- PDF-space `left`, `right`, `top`, `bottom`, `x`, `y`, `width`, `height`
- `wordCount` + `features` (diagnostic)

Lines not present in `page.text` (furniture skipped by today’s band rule, unused isolated lines, dense-grid pages) have no norm range.

---

## 4. Candidate PageRegion model

`PageRegion` exists with `role: "candidate"`. 4A.9.1 never writes it into `detectReadingOrder`, `normalizePage`, or `buildDocumentChunks`.

`analyzePageRegions` clusters **prose items** by left edge (not exact cluster count). It reports x, population, prose-line count, y-span, widths, gutter, short/math noise, and prose-mass share.

---

## 5. DocumentBlock model

Type defined:

`paragraph | heading | list | list-item | caption | prose | unknown`

Production `deriveDocumentStructure` always sets `blocks: []`. 4A.9.3 owns reconstruction. Cards must not cite `DocumentBlock.id`.

---

## 6. Deterministic identities

```
${sourceId}:p${page}:line:${ordinal}
${sourceId}:p${page}:region:${ordinal}
```

Ordinal is the stable `groupVisualLines` / cluster order. No UUIDs. Same bytes + versions → same IDs (tested).

---

## 7. Normalized-range mapping

Ranges come from existing `MappedSegment`s for the line’s `itemIndexes` (`min normStart` … `max normEnd`). No `page.text` search.

Invariant: `page.text.slice(normStart, normEnd)` equals that mapped span, including same-line inserted spaces and excluding the dropped soft-hyphen. Mapping coverage stays 100% (`mappingErrorCount` on the corpus: **0**).

---

## 8. Geometry convention

PDF user space as stored on `item.transform`: origin **bottom-left**, x right, y up. `top` / `bottom` are y-up. Viewer / CSS conversion stays outside this IR. `sizeSource` is `viewport` when the caller supplies page size, otherwise `inferred-items` (max `itemRight` / `itemY+height`) so a cached `NormalizedDocument` is enough.

---

## 9. Prose features (diagnostic only)

Per line: word count, alpha / numeric / punct ratios, average token length, item count, width, capitalization share, bullet prefix, equation-symbol ratio, short-token ratio, `proseScore` (0–1, unused for classification).

Page prose mass: alphabetic characters in left-edge prose-item clusters. Reported as `proseMassShare` and `proseMassShareTop2`. No thresholds frozen for 4A.9.2.

---

## 10. Attention diagnostics

All 15 pages: `crossGutterRisk = true`. False single-column pages 2, 3, 7, 10–12 still have that flag and **unchanged** `page.text`. Overflow-width items and same-y left/right joins are listed in `attention-pages.json`. `twoDominantProse` is only 3/15 — Attention’s inflated widths still hide the second column from item-left clustering. That is the 4A.9.2 width-distrust problem, now observable.

---

## 11. BERT / ResNet diagnostics

| PDF | twoDominantProse pages | current two-column pages |
|---|---:|---:|
| bert.pdf | **16 / 16** | 0 |
| resnet.pdf | **12 / 12** | 0 |
| tracemonkey.pdf | 13 / 14 | 0 |

Despite >2 x clusters, two body columns dominate prose mass. `readingOrder` remains `uncertain`.

---

## 12. CS229 grid-vs-math

28 pages written to `cs229-pages.json`. 27 still `skipped` + `denseGrid: true`. Hypothesis **likely-math** on 27 pages (long prose lines + high alpha + aligned short tokens). Page 14 (the only isolated page) is `unknown`. Production index unchanged.

---

## 13. List diagnostics

Candidates only; not joined.

- nist-800-63b: 150
- cisa-ransomware: 135
- omb-m22-09: 77
- nist-800-207: 62

Chunk counts unchanged.

---

## 14. Caption diagnostics

Conservative `Figure|Fig.|Table|Tbl.|Algorithm` + number. Attention 10, BERT 13, LoRA 26, ResNet 20. Not merged, not re-indexed.

---

## 15. Furniture diagnostics

Repeated text is counted **across any y**, not only the 72pt band.

NIST 800-63B / 800-207: `This publication is available free of charge from: https://doi.org/10.6028/NIST.SP.800-63b` (and the 207 twin) appear with `bodyBand: true` (y≈564). **Not stripped.**

---

## 16. Persistence / versioning

`DOCUMENT_STRUCTURE_VERSION = 1`. Parser and normalizer versions not bumped.

Structure is **not** on the warm hydration path. No Dexie table. Derive on demand from `NormalizedDocument`.

Stale structure (version mismatch) → `deriveDocumentStructure(cachedNormalizedDocument)` → no Blob, no PDF.js.

---

## 17. Lazy rebuild proof

After `parsePdf`, `resetPdfjsDocumentOpenCount()` then `deriveDocumentStructure(document)` → **`pdfjsOpensDuringDerive: 0`** on every ready PDF. Unit test: lecture fixture, count stays 0, `sizeSource: "inferred-items"`.

Warm hydrate still loads stored chunks only.

---

## 18. Structure derivation timings

From an already-loaded `NormalizedDocument` (ms):

| PDF | pages | deriveMs |
|---|---:|---:|
| attention | 15 | 15 |
| bert | 16 | 19 |
| cs229-notes | 28 | 17 |
| nist-800-207 | 59 | 27 |
| nist-800-63b | 80 | 33 |
| cisa-ransomware | 31 | 17 |

No optimization pass.

---

## 19. Chunk equality proof

Uncapped `buildDocumentChunks` per ready PDF equals the frozen 4A.9 table. Total **7,616**. `chunkMismatches: []`. Eight PDFs still exceed 200. Largest-5 sum still 5,686.

The 4A.9 “6,017 isolated-line origin” count classified list/caption/header separately. Chunks whose **page.index** is `isolated-lines` are 6,536. Production output did not change; only the diagnostic label split did.

---

## 20. Card / retrieval equality proof

4A.8.1 frozen metrics (directory not rewritten): genuine wrong-intent 0, unanswerable spoken 0, spoken 13, answerable hit **9/89**.

Controlled post-contract re-run written only to `4a9.1/card-bench.json`: **17/22**, wrong-intent 0, unsupported 0, same five silences.

Retrieval re-run written only to `4a9.1/retrieval-bench.json`: top1 **5/6**, top3 **5/6**, top6 **6/6** (matches frozen 4A.3 / 4A.8.1 ranks).

---

## 21. Baseline comparisons

| Baseline | Result |
|---|---|
| Phase 3.5 `phase35-compare` | `ok: true` (chips / cards / retrieval empty diffs) |
| 4A.4.1 `card-bench-4a41.json` | not overwritten |
| 4A.8.1 safety dir | not overwritten |
| Classification totals | 326 / 242 / 70 / 14 / 187 / 55 — **match: true** |
| Uncapped chunks | **7,616**, per-file equal |
| Mapping errors | 0 |
| Structure validators | 0 errors on the ready corpus |
| `npm test` | pass |
| `npm run lint` | 0 errors |
| `npm run typecheck` | pass |
| `npm run build` | pass |

---

## 22. Risks / findings that should shape 4A.9.2

1. **Attention width distrust is mandatory.** Item-left clustering still misses most Attention body columns because `width` crosses mid. `crossGutterRisk` is the signal; `twoDominantProse` is not enough there.
2. **False single-column is worse than uncertain.** Attention p2/p3 already join. 4A.9.2 should refuse single-column when `crossGutterRisk` is high.
3. **Cross-gutter is noisy** on CISA/NIST (almost every page). Tighten to two multi-word items that straddle mid, or overflow width **and** a second item past mid — not every wide line.
4. **CS229 is likely-math, not a table.** 27/27 skipped grid pages have long prose lines. Do not loosen `isDenseGrid` globally; carve math vs lattice.
5. **BERT/ResNet/TraceMonkey are ready for dominant-region two-column** without waiting on Attention’s width bug.
6. **Furniture at y≈564** is now listed. Stripping waits for 4A.9.3; do not use the 72pt band alone.
7. **Do not raise 200/800.** 7,616 is unchanged on purpose.
8. **Blocks stay empty** until 4A.9.3. Do not chunk from candidate regions yet.

---

## Acceptance

- Structural IR exists and is deterministic
- Item indexes never renumbered
- Attention cross-gutter observable; text unchanged
- BERT/ResNet two dominant regions observable; readingOrder unchanged
- CS229 math features observable; skipped unchanged
- NIST furniture observable; not removed
- Rebuild needs no Blob / PDF.js
- Chunks 7,616 identical per file
- Evidence / mapping / QuestionContract untouched
- 4A.9.2 not started
