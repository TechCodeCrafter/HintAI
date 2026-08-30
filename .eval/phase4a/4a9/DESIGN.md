# Phase 4A.9 — Real-world PDF structure (design / diagnostic)

**Status:** design only. No parser, normalizer, layout, chunking, retrieval, or admission code was changed. Landing stays **PDF · Coming soon**. Phase 4A.10 was not started.

**Frozen floors (do not weaken):**

- `.eval/phase35/` — Phase 3.5 code truth
- `.eval/phase4a/card-bench-4a41.json` — controlled PDF capability 22/22 pre-contract
- `.eval/phase4a/4a8.1/` — genuine wrong-intent 0, unanswerable spoken 0, unsupported 0, fabricated 0, page/location 100%, controlled cost 17/22, real-world hit 9/89

The 4A.7 126 is development/regression data only. It is not a ship test. QuestionContract is not in scope.

Generated: 2026-08-30. Script: `scripts/pdf-4a9-diagnose.ts` (read-only against current `parsePdf` / `layout.ts` / `normalize.ts` / `chunk.ts`). Machine artifacts live beside this file.

---

## 1. Real-corpus structural table

Ready PDFs only unless noted. Chunks are **uncapped** `buildDocumentChunks` counts (the 200/800 caps are not the subject of this phase).

| PDF | bytes | pages | extracted chars | readiness | 1-col | 2-col | uncertain | full | isolated | skipped | chunks | avg/page | max/page | >200 |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| attention.pdf | 2.2M | 15 | 25,011 | ready | 6 | **0** | 9 | 6 | 3 | 6 | 158 | 10.5 | 35 | no |
| bert.pdf | 775k | 16 | 57,959 | ready | 0 | **0** | 16 | 0 | 14 | 2 | 781 | 48.8 | 64 | yes |
| bitcoin.pdf | 184k | 9 | 18,960 | ready | 7 | 0 | 2 | 7 | 1 | 1 | 118 | 13.1 | 28 | no |
| cisa-ransomware.pdf | 1.0M | 31 | 68,147 | ready | 1 | 0 | 30 | 1 | 30 | 0 | 945 | 30.5 | 54 | yes |
| cs229-notes.pdf | 357k | 28 | 2,035 | ready | 0 | 0 | 28 | 0 | 1 | **27** | 27 | 1.0 | 27 | no |
| lora.pdf | 1.6M | 26 | 40,827 | ready | 9 | 0 | 17 | 9 | 2 | 15 | 353 | 13.6 | 75 | yes |
| nist-800-145.pdf | 86k | 7 | 10,665 | ready | 1 | 1 | 5 | 2 | 5 | 0 | 129 | 18.4 | 42 | no |
| nist-800-207.pdf | 967k | 59 | 151,787 | ready | 28 | 5 | 26 | 33 | 26 | 0 | 1,154 | 19.6 | 42 | yes |
| nist-800-63b.pdf | 1.5M | 80 | 188,798 | ready | 4 | 5 | 71 | 9 | 70 | 1 | 2,080 | 26.0 | 39 | yes |
| omb-m22-09.pdf | 935k | 29 | 78,774 | ready | 13 | 3 | 13 | 16 | 13 | 0 | 578 | 19.9 | 37 | yes |
| resnet.pdf | 819k | 12 | 50,804 | ready | 0 | **0** | 12 | 0 | 10 | 2 | 567 | 47.3 | 77 | yes |
| tracemonkey.pdf | 1.0M | 14 | 77,325 | ready | 1 | 0 | 13 | 1 | 12 | 1 | 726 | 51.9 | 71 | yes |
| rfc9110.pdf | 2.9M | 194 | 0 | refused | — | — | — | — | — | — | 0 | — | — | — |
| nist-800-12.pdf | 1.3M | 101 | 0 | refused | — | — | — | — | — | — | 0 | — | — | — |
| irs-p15.pdf | 1.7M | 59 | 0 | refused | — | — | — | — | — | — | 0 | — | — | — |
| scanned.pdf | 21k | 1 | 0 | scanned | — | — | — | — | — | — | 0 | — | — | — |
| encrypted*.pdf | — | 0 | 0 | unreadable | — | — | — | — | — | — | 0 | — | — | — |

**Uncapped ready total: 7,616 document chunks.** Eight PDFs exceed 200 chunks. A 5-PDF Context of the five largest is **5,686** chunks (vs cap 800).

Per-document JSON: `documents/*.json`.

---

## 2. Page classification totals

Across 12 ready PDFs (326 pages):

| readingOrder | n | index | n |
|---|---:|---|---:|
| single-column | 70 | full | 84 |
| two-column | **14** | isolated-lines | **187** |
| uncertain | **242** | skipped | **55** |

Docs: 12 ready, 3 refused, 1 scanned, 2 unreadable.

Every skipped page in this corpus failed for the **same earliest reason: `dense-grid`** (55/55). There were zero skips from “no useful items”, “uncertain with no usable isolated lines”, or empty single-column join.

Two-column today is almost only NIST/OMB. Academic two-column papers contribute **0**.

---

## 3. Exact two-column failure root causes

Current gate (`layout.ts`):

1. `isDenseGrid` → uncertain / skip (normalize short-circuits).
2. `leftEdgeClusters` in 36pt buckets, merge if Δx ≤ 36.
3. `twoColumnPair` requires **exactly two** substantial clusters (≥2 items), separated by ≥ max(56pt, 18% width), straddling 45% width.
4. `isConfidentTwoColumn` then needs ≥2 prose lines/side, y-span ≥12, 30% y-overlap, 28pt item-x gutter.
5. Else a mid-page fallback: if both sides of mid have ≥2 visual lines **and** first-x spread > 35% width → **uncertain** (never two-column).
6. Else **single-column**.

The failure is exactly “require two left-edge clusters,” plus a fallback that prefers uncertain (or, worse, single-column) over two dominant body columns.

### BERT (16/16 uncertain; 14 isolated-lines; 2 dense-grid skip)

Page 2 geometry is a clean academic two-column page:

- Dominant left-edge clusters **x≈77.5 (51 items)** and **x≈308.4 (51 items)**, full y-span, widths ~174–187pt.
- Extra substantial clusters at 164, 216, 270, 349, 389 (indents, inline fragments).
- Classifier: `substantial left-edge clusters 7 !== 2` → pair null → start-x spread 246 > 35% width → **uncertain → isolated-lines**.

A prose-only cluster of the same page reports **two dominant regions** (16/16 BERT pages). The body is two-column. The exact-2 rule is what fails.

### ResNet (12/12 uncertain; 10 isolated; 2 dense-grid skip)

Page 2: clusters **x≈53 (46)** and **x≈308 (53)** plus six indent/math/caption clusters. Same reason: `substantial 8 !== 2` then fallback uncertain. 11/12 pages have two dominant prose regions.

### TraceMonkey (13 uncertain, 12 isolated)

Page 2: **x≈58 (71)** and **x≈325 (55)** plus citation/indent clusters. Same exact-2 failure. 13/14 pages two-dominant-prose.

### Attention (0 two-column; 6 single-column **full**; 3 isolated; 6 dense-grid skip)

Different and worse.

Page 2 items are often one long string at **x=108, width=396, right=504** (page width 612). That reported box crosses mid. Extra clusters come from **inline math split into one-character PDF.js items** (`h`, `t`, `−`, `1`) on the same visual y as the body line.

`twoColumnPair` sees 6 substantial clusters, not 2. The uncertain fallback **does not fire** (line-start spread stays under 35% because almost every visual line starts at 108). The page is labeled **`single-column` / `full`**.

That is false confident ordering: left-column prose, gutter math, and anything that shares a y are joined as one stream. Isolated-lines would have been safer. Pages 2, 3, 7, 10, 11, 12 take this path.

The diagnostic “two dominant prose items” heuristic also misses Attention, because almost every prose item shares one left edge and an overflowing width. Attention needs **width distrust** (treat `width` as overflow when `x + width` crosses mid and the string is one column of words) plus column assignment by **left edge of long items**, not by reported right edge.

### Root cause (no guessing)

| Paper | Geometry | Why today fails |
|---|---|---|
| BERT | Two equal body columns + title/indent/caption leftovers | Exact-2 cluster rule; fallback → uncertain → isolated-lines |
| ResNet | Same | Same |
| TraceMonkey | Same | Same |
| Attention | Inflated item widths + 1-char math on the body y | Exact-2 fails; fallback does **not** fire → **false single-column** |

“Exactly two x clusters” ≠ “two dominant prose regions.” Real papers have title, authors, equations, captions, page numbers, and two body columns.

---

## 4. Exact CS229 skip root causes

**27/28 pages skipped. Earliest reason on all 27: `dense-grid`.**

Page 14 is the only indexed page (`isolated-lines`, 27 chunks). Extracted document text is 2,035 characters.

`isDenseGrid` (`layout.ts`): ≥12 nonempty items, ≥3 recurring x-buckets (8pt), ≥3 recurring y-buckets, and ≥70% of tokens have `trim.length ≤ 12`.

CS229 pages are single-column lecture notes. They are not tables. Page 2: 157 items, 29 visual lines, 8 left-edge clusters. The extra x columns are **equation alignment** (symbols, subscripts, short math tokens), not a 2-D data grid. Page 1 would have had 9 isolated-usable lines if the grid detector had not fired first.

| Earliest skip reason | pages |
|---|---:|
| dense-grid | **27** |
| uncertain / no usable isolated lines | 0 |
| no useful items | 0 |
| other | 0 |

Do not change the grid threshold in this design turn. The design change is: **a page with long prose visual lines and short tokens that are 1–2 character math must not be classified as a table.** Tables stay skipped. Math notes must not.

LoRA (15 skips) and Attention (6 skips) are also 100% dense-grid. Some of those pages really are figures/tables and should stay skipped. CS229 is the false-positive.

---

## 5. Chunk-explosion breakdown

Uncapped origin of all 7,616 ready chunks (current chunker: each newline block on isolated-lines is one chunk; full pages split on newlines, then 1200-char sentence/whitespace):

| Origin | n | % |
|---|---:|---:|
| isolated line | **6,017** | **79.0** |
| paragraph split (newline block ≤1200 on `full`) | 971 | 12.7 |
| list-line | 439 | 5.8 |
| header/footer leakage | 98 | 1.3 |
| caption | 73 | 1.0 |
| full-page block | 18 | 0.2 |
| sentence split / hard char split | 0 | 0 |

**Primary cause: B, driven by A.**

1. **A. Layout uncertainty** (242/326 pages) refuses paragraph join.
2. **B. Isolated-line fallback** then emits one chunk per usable visual line (50–77 chunks on BERT/ResNet/TraceMonkey pages).
3. **C. Missing paragraph reconstruction** is why those lines are not blocks. The chunker never sees a paragraph; it only sees newlines.
4. **D. PDF.js fragmentation** is real (Attention 1-char math; BERT leftover spaces; fixture `extra ch`) but is not the volume driver.
5. **E. Header/footer leakage** is 98 chunks and a retrieve-quality problem, not the 7,616 problem.

Raising 200/800 would only index more noise. Structure first.

---

## 6. Header / footer findings

Current rule: same visual-line text, same 72pt top/bottom band, on ≥50% of pages.

**What it catches:**

- CISA: `TLP:CLEAR` (header, 31/31)
- NIST 800-207: `NIST SP 800-207 ZERO TRUST ARCHITECTURE` (header, 56/59)
- NIST 800-63B: running title pair (header, 76/80)

**What it misses:**

`This publication is available free of charge from: https://doi.org/10.6028/NIST.SP.800-63b` (and the 800-207 twin) sits at **y ≈ 564** on a 792pt page. That is the **body** band. The 50% band detector never sees it. Isolated-lines then glue it onto the next usable line. 4A.8 already showed this string in retrieve hits.

Academic papers in this corpus have **no** detected running headers (0 on Attention/BERT/ResNet/Bitcoin/LoRA/TraceMonkey). Page numbers and venue lines are often unique per page or outside the 72pt band.

**Design (do not implement yet):**

- Keep the ≥50% same-text + same-band rule. It is not wrong; it is incomplete.
- Add a second detector: identical (or DOI-normalized) string on ≥50% of pages **at a stable x**, any y. That is still furniture, not “near the edge.”
- Do **not** drop unique sentences that happen to sit in the top/bottom 72pt.
- Stripped items stay on `page.items`. They leave `page.text`. Evidence cannot cite them.

---

## 7. Table / grid findings

Dense-grid pages: 55. All become skipped. That is the correct action **when the page is a table**.

False positives: CS229 27 pages (math), and an unknown subset of LoRA/Attention figure pages that mix captions with aligned tokens.

**Keep:** never flatten a real grid into prose to raise coverage.

**Distinguish two prose columns from a table:**

| Signal | Two prose columns | Table / dashboard |
|---|---|---|
| Prose visual lines (≥4 words or a sentence) | Many, stacked, large y-overlap | Few; cells are short |
| Left-edge of long items | Two dominant x’s | Three or more recurring x **and** y |
| Token length | Median word ≥4 letters | ≥70% tokens ≤12 chars **and** lattice |
| Numbers | Occasional | Dominant in the aligned cells |
| Gutters | One wide vertical gap | Many small equal gaps |

Math notes: short tokens exist, but they sit **inside** long visual lines, not in a regular cell lattice. Require lattice + short-token dominance **and** the absence of a dominant pair of long-prose columns before `dense-grid` wins.

No table-derived numerical relations in 4A.9.

---

## 8. List findings

Visual lines matching a conservative bullet/enumerated prefix:

| PDF | list-like visual lines | isolated pages |
|---|---:|---:|
| nist-800-63b | 150 | 70 |
| cisa-ransomware | 135 | 30 |
| omb-m22-09 | 77 | 13 |
| nist-800-207 | 62 | 26 |
| bert | 24 | 14 |
| bitcoin | 18 | 1 |
| others | ≤19 | — |

On isolated-lines pages each member is its own chunk (`list-line` 439). QuestionContract enumeration needs a **page-local list** (heading + ordered members), not 150 independent lines.

Do not synthesize members across pages.

---

## 9. Caption findings

Lines matching `Figure|Fig.|Table|Tbl. + number`:

LoRA 26, ResNet 20, NIST 207 23, BERT 13, Attention 10, TraceMonkey 10, 63B 11, CISA 3.

A caption is searchable prose. Axis ticks, legend swatches, and detached tokens are not. Design: a `caption` block only when the line matches the caption prefix **and** has ≥4 words or a sentence. Chart crumbs stay out of `page.text` (or stay isolated and fail sayability).

---

## 10. Broken PDF.js text findings

Separate **normalizer bugs** from **source string damage**.

Measured:

- Attention body items: `str` is a full column line; `width` is 396pt and crosses mid. That is PDF.js/box damage, not a join bug. The normalizer must not invent a second column from a single `str`.
- Attention inline math: `h` / `t` / `−` / `1` as separate items. Retain exact `str`. Do not spell “hidden state.”
- BERT: leftover space items (`str: " "`). Harmless if ignored for clustering; they already have empty useful-text.
- NIST: empty `str` items at the furniture x. Ignore for clustering.
- Controlled fixture (already known): `"extra ch"` instead of `"checks are"`. **Do not rewrite.**

**Policy for structural logic:**

- Always keep `item.str` verbatim in `page.items`.
- Mapping/currentness reconstruct from those strings only.
- A block whose mapped source is mostly 1–2 character fragments, or whose `str` is a known clip (`extra ch`), is **low-readability**: eligible for skip or sayability failure, never for invented repair.
- `paper-checks` may become speakable later only if a future extract independently contains the missing words. The normalizer will not add them.

---

## 11. Proposed structural IR

Derived structure. **Not evidence.** `DocumentEvidence` still resolves to exact source items via `itemRanges`.

`NormalizedPage` keeps `items`, `segments`, `text`, `readingOrder`, `index`, `columnBreakOffset`. Add an optional derived list:

```ts
type DocumentBlock = {
  id: string;                    // `${sourceId}:p${page}:b${i}`
  kind: "paragraph" | "heading" | "list" | "caption" | "prose" | "unknown";
  column?: 0 | 1;
  regionId?: string;
  normStart: number;
  normEnd: number;
  itemIndexes: number[];         // PDF.js stream indexes, not renumbered
  lineIds: number[];             // visual-line ids on this page
  geometry?: {
    x0: number; y0: number; x1: number; y1: number;
  };
  readability: "ok" | "low";
};

type ListBlock = DocumentBlock & {
  kind: "list";
  headingNorm?: { start: number; end: number };
  members: Array<{ normStart: number; normEnd: number; marker?: string; indent?: number }>;
};
```

Invariants:

- Every source character in `page.text` belongs to at most one block.
- Inserted spaces/newlines may sit on block edges; they are never given an `itemIndex`.
- Blocks never span pages.
- Blocks never cross a column/region boundary.
- `index: "skipped"` pages have no blocks and no chunks.
- Mapping coverage stays 100%. Exact source reconstruction stays 100%.

Do not treat this type as sacred. The required properties are identity, offsets, coverage, page-local provenance, column, and visual-line membership.

---

## 12. Proposed dominant-prose-region algorithm

Output remains `single-column | two-column | uncertain`. **No `stream`.**

Work on **prose items** (item has ≥2 words with a 3+ letter token, or `str.length ≥ 24`), not every glyph.

1. Cluster those items by **left edge** (keep ~36pt buckets, or a slightly wider merge).
2. Rank clusters by item count. A cluster is dominant if it holds a large share of prose items **and** a large y-span.
3. If the top two are separated by a gutter (≥ max(56pt, 18% width)), straddle mid, and their y-spans overlap (≥ ~30% of the shorter): tentatively **two regions**.
4. Assign each visual line to a region by the left edge of its longest prose item (not `itemRight`, not overflowing width).
5. Title / author / page-number / caption lines that are full-width or outside both regions stay in a **page-level rail**. They do not add a third column and do not veto the pair.
6. **Veto → uncertain** (never two-column, never single-column) when:
   - three or more dominant prose regions,
   - a true dense grid / table (see §7),
   - regions overlap in x (no gutter after width-distrust),
   - either region lacks stacked prose,
   - sidebar + body (narrow third rail with comparable y-span).
7. **single-column** only when there is one dominant prose region and start-x spread is small after ignoring the rail.
8. Attention-style overflow: if `itemRight` crosses mid but the next item on the same y is 1–3 character math, do not treat the box as a full-width line.

False confident single-column (Attention p2) is worse than uncertain. When the pair is unclear, stay uncertain and wait for block reconstruction of **isolated regions**, not of the whole page as one stream.

---

## 13. Proposed block reconstruction

Inside one region only. Deterministic. No LLM. No embeddings.

Signals, in order:

1. Column / region membership (hard boundary).
2. Vertical gap > ~1.85× line height → new block (`isParagraphBreak` already exists).
3. Indent that starts a bullet/number marker → `list` (continue while indent and marker hold).
4. Caption prefix → `caption` (do not join into the previous paragraph).
5. Heading: larger `height` than the page’s body mode **and** a following gap. Outline titles remain metadata only; do not invent headings from semantics.
6. Sentence continuation: next line starts lowercase and gap is line-spacing, not a paragraph gap → same paragraph. Soft hyphen already exists (`[A-Za-z]-` + `[a-z]`).
7. Low-readability: majority of items in the line are 1–2 character fragments → `unknown` / `readability: "low"`. Do not glue them into a fake sentence.

Lists: one `ListBlock` per page-local run. Heading is the immediately preceding line in the same region if it is not itself a member. Members keep marker and indent. No cross-page lists.

Uncertain pages: reconstruct **inside each region independently**. Still no cross-region join. If a region cannot be ordered, leave those lines isolated or skip the region.

---

## 14. Mapping / provenance implications

- Blocks are derived. They do not replace `MappedSegment`.
- A Card still maps `[normStart, normEnd)` → source segments → `itemRanges` → `sourceText`.
- If reconstruction changes joins, `page.text` changes → **normalizer version bump** → previous `DocumentEvidence` is uncurrent (already the rule).
- Viewer highlight stays item + char range. Failed map → page + caption, no fuzzy box.
- QuestionContract, support, currentness, citations, thread: untouched. New coherent evidence may speak **only** if it independently passes the frozen contract.

---

## 15. Versioning / cache plan

Current: `PDF_PARSER_VERSION = 1`, `DOCUMENT_NORMALIZER_VERSION = 2`, `DOCUMENT_CHUNKER_VERSION = 1`. `CHUNKER_VERSION` (code) stays 1.

| Change | Bump | Reparse PDF.js? |
|---|---|---|
| Structural types only, `page.text` unchanged, chunker still newline-based | none required; optional `DOCUMENT_STRUCTURE_VERSION = 1` on the row | no |
| Dominant-region / join / header rules change `page.text` or segments | `DOCUMENT_NORMALIZER_VERSION` | **no** — `page.items` already stored |
| Chunks built from blocks instead of raw newlines | `DOCUMENT_CHUNKER_VERSION` | no |
| PDF.js pin or `getTextContent` options | `PDF_PARSER_VERSION` | **yes** |

Cache:

```
same Blob (sourceId + contentHash)
  → derived NormalizedDocument stale if parser or normalizer version differs
  → rebuild from cached items if only normalizer/structure changed
  → rechunk if document-chunker version differs
  → no network
```

Warm hydrate still restores `DocumentChunk`s only. Blobs and `NormalizedDocument` stay on demand. Do not re-open PDF.js to re-join items.

---

## 16. Projected chunk-count reduction

Naive projection (join visual lines inside a dominant pair using today’s paragraph-gap + list/caption breaks; one chunk per block; 1200-char split). **Not implemented.**

| PDF | current | projected | Δ |
|---|---:|---:|---:|
| attention.pdf | 158 | 129 | −18% |
| bert.pdf | 781 | 435 | −44% |
| bitcoin.pdf | 118 | 72 | −39% |
| cisa-ransomware.pdf | 945 | 309 | −67% |
| cs229-notes.pdf | 27 | 218 | **+707%** (skipped pages return) |
| lora.pdf | 353 | 254 | −28% |
| nist-800-145.pdf | 129 | 49 | −62% |
| nist-800-207.pdf | 1,154 | 492 | −57% |
| nist-800-63b.pdf | 2,080 | 842 | −60% |
| omb-m22-09.pdf | 578 | 270 | −53% |
| resnet.pdf | 567 | 296 | −48% |
| tracemonkey.pdf | 726 | 257 | −65% |
| **ready total** | **7,616** | **3,623** | **−52%** |

CS229 rises because 27 silent pages would become real text. That is desired if the grid false-positive is fixed.

This projection is **still too high**. It does not yet do true two-column paragraph merge on BERT/ResNet (those pages stay fragmented because the current pair detector is unused). A successful 4A.9.2+4A.9.3 should land BERT/ResNet/TraceMonkey nearer **8–15 blocks/page** (~130–240 chunks each), not 30–50.

5–10 PDF Context (projected, naive): five largest still **~2,300+**. Even after a better join, 80-page NIST 800-63B at 8 chunks/page is ~640 by itself.

---

## 17. Should 200 / 800 remain frozen?

**Yes, for now.** Do not raise caps to paper over isolated-lines.

Reassess only after 4A.9.4 with measured post-block counts. Likely outcome:

- 200/PDF may still be right for a single academic paper and tight for 800-63B-class manuals.
- 800/Context will still bite a 5-PDF policy pack. That is a product limit, not a reason to flatten tables or stream uncertain pages.

---

## 18. Proposed 4A.9 implementation phases

| Phase | Work | Out of scope |
|---|---|---|
| **4A.9.1** | Add derived `DocumentBlock` on `NormalizedPage` (possibly empty). Dump-stable diagnostics. `DOCUMENT_STRUCTURE_VERSION`. No join change. | admission, retrieve |
| **4A.9.2** | Dominant prose regions; width-distrust; grid vs math/table. Still `uncertain` when unsure. Fix Attention false single-column (prefer uncertain over stream). CS229 math must stop dying as dense-grid **without** flattening real tables. | chunker rewrite |
| **4A.9.3** | Line → paragraph / list / caption / unknown inside a region. Header detector for repeated body-band furniture. | QuestionContract |
| **4A.9.4** | `buildDocumentChunks` from blocks. Bump `DOCUMENT_CHUNKER_VERSION`. | raising 200/800 |
| **4A.9.5** | Real-world parser regression (structure metrics, not 126 labels). Controlled 4A.4.1 re-run. Phase 3.5 compare. Budget reassessment. | 4A.10, landing change |

4A.9.2 before 4A.9.3 because CS229 and Attention are classification bugs; joining isolated lines first would cement wrong adjacency.

The five controlled silences (`lecture-concurrent`, `multi-deadlock`, `paper-checks`, `bullets-list`, `slides-phantom`) are **not** targets. They may return only if new evidence independently satisfies the frozen contract. No per-ID parser branches.

---

## 19. Risks / likely failure modes

1. **False two-column** on a 3-rail brochure or a sidebar. Stay conservative; uncertain > stream.
2. **False single-column** (Attention today) joins columns. This is the highest-severity layout bug in the corpus.
3. **Grid loosening** that lets a real table become prose. Coverage theatre; forbidden.
4. **CS229 over-correction** that indexes equation crumbs as lists.
5. **Header detector** that strips unique abstracts sitting in a top band.
6. **Block IR that becomes evidence.** It must not. Support stays last and lexical.
7. **Tuning on the 126.** Structural decisions come from geometry, not expected answers.
8. **Projection optimism.** Naive join only halves 7,616. Caps will still bind until paragraphs are real.
9. **Version confusion.** Changing `page.text` without a normalizer bump would leave stale Cards current.
10. **PDF.js clips.** Repairing `extra ch` → `checks are` would create unsupported spoken words.

---

## Structural quality targets (not hit-rate)

Measure on a **manually audited page set** (Attention 1–3, BERT 1–3, ResNet 1–3, CS229 1–3 and 10, TraceMonkey 1–2, NIST 145/207/63B mixed), not on the 126 labels.

| Target | Intent |
|---|---|
| Two-column detection matches audit on body pages | BERT/ResNet/TraceMonkey body = two-column; Attention body ≠ false single-column |
| Zero synthetic cross-column joins | `page.text` never concatenates two regions |
| Zero table-to-prose flattening | true grids stay skipped |
| Mapping coverage 100% | existing `mappingErrors` stay empty |
| Exact source reconstruction 100% | currentness unchanged |
| Isolated-line pages drop sharply on prose documents | BERT 14 → near 0 body pages |
| Chunks/page on prose-heavy pages in a **measured** band | audit first; 4–12 is a hypothesis, not a hard-coded gate |
| No silent truncation | skipped pages have an explicit reason |

Do not use 9/89 → N/89 as the 4A.9 exit metric.

---

## 4A.8.1 safety (binding)

Future implementation must not modify: `question-contract.ts`, df=0, source-selector hard filters, predicate/type/enumeration admission, thread semantics, evidence mapping, currentness, support, citations, viewer provenance.

A better parser may make previously silent Cards eligible. Allowed only if they pass the frozen contract on their own.

---

## Artifacts

| Path | Contents |
|---|---|
| `corpus-table.json` | compact per-PDF table |
| `classification-totals.json` | page totals |
| `documents/*.json` | per-document structural report |
| `pages/*-pN.json` | item-level geometry for audited pages |
| `two-column-failures.json` | Attention / BERT / ResNet |
| `cs229-skips.json` | all 27 skips + reason |
| `chunk-explosion.json` / `chunk-projection.json` | origins + projection |
| `headers.json` `tables.json` `lists.json` `captions.json` `broken-items.json` | audits |
| `summary.json` | machine headline |

Do not modify `.eval/phase4a/release/`, `.eval/phase4a/4a8.1/`, or `.eval/phase35/`.
