# Phase 4A.7 — Real-world PDF release gate

Blind baseline frozen in `.eval/phase4a/release-baseline/`.
Working artifacts in `.eval/phase4a/release/`.
Development and Phase 3.5 artifacts were not overwritten.
Landing still shows **PDF · Coming soon**. No implementation was tuned on this corpus.

**Recommendation: KEEP COMING SOON**

Safety failed on the blind real-world set (wrong-intent Cards, including 20 unanswerable questions that spoke). Usefulness is far below the 75% product bar (14/89 = 16% answerable hit). Production ingest would also refuse most of these PDFs for exceeding 200 chunks.

---

## 1. Corpus composition (18 PDFs)

| ID | Family | Pages | Parse readiness |
|---|---|---|---|
| cs229-notes.pdf | A lecture (normal, math-heavy) | 28 | ready — 27/28 pages skipped |
| cisa-ransomware.pdf | A bullets + C ops + E headers | 31 | ready — 945 chunks |
| attention.pdf | B two-column + figures | 15 | ready — 0 two-column detected |
| bert.pdf | B academic + figures | 16 | ready — all uncertain |
| resnet.pdf | B two-column + tables | 12 | ready — all uncertain |
| lora.pdf | B academic | 26 | ready |
| bitcoin.pdf | B single-column | 9 | ready |
| tracemonkey.pdf | B/C systems paper | 14 | ready |
| nist-800-145.pdf | C technical definition | 7 | ready |
| nist-800-207.pdf | C architecture | 59 | ready |
| nist-800-63b.pdf | D policy + E headers | 80 | ready (at page cap) |
| omb-m22-09.pdf | D policy / briefing | 29 | ready |
| rfc9110.pdf | F over page limit | 194 | refused |
| nist-800-12.pdf | F over page limit | 101 | refused |
| irs-p15.pdf | F over char limit + tables | 59 | refused (too much text) |
| scanned.pdf | F image-only | 1 | scanned |
| encrypted-sample.pdf | F third-party encrypted | — | unreadable |
| encrypted.pdf | F Standard /Encrypt object | — | unreadable |

Gap: no redistributable exported slide deck (hosts 403). Sparse CISA/OMB covers and repeated headers stand in.

Licenses and obtain URLs: `corpus/manifest.json`. CS229 notes are course material posted publicly; treat redistribution as restricted.

Labels were written from raw PDF.js `getTextContent` dumps (`dumps/`), not from MeetHint Cards.

## 2. Question counts

- 89 answerable (spread across 12 text PDFs; no one lecture dominates usable indexable text)
- 37 unanswerable (lexically tempting attacks on vendor, cost, ownership, passwords, growth rate, phone, KYC, ransom amount, …)
- Total 126

## 3. Blind PDF metrics (frozen)

From `release-baseline/card-run.json` / `release/card-run.json`:

| Metric | Result |
|---|---|
| Wrong-intent Card rate | **54% (68/126)** — FAIL |
| Unsupported Card rate | **0% (0/82 spoken)** — verifyClaim passed |
| Fabricated provenance | **0** |
| Page citation accuracy | **100% (82/82)** |
| Evidence-location accuracy | **100% (82/82)** |
| Answerable hit rate | **16% (14/89)** |
| False silence | **30% (27/89)** |

Wrong-intent breakdown (labels not edited):

- 20 unanswerable questions spoke
- 21 answerable Cards cited the **wrong PDF**
- 27 answerable Cards cited the expected PDF but missed the pre-written span (17 of those were the expected page)

Even if the 17 same-page span misses were counted as hits, hit rate would be 31/89 ≈ 35% — still below 60%.

## 4. Readable Hint rate

Automated heuristic: **100% (82/82)**.

Human spot-check of spoken Cards found hyphenation / column-split fragments (`Tion model called BERT`, `Trace- Monkey`). Those remain supported. Do not rewrite PDF text generatively. Prefer silence when extraction is damaged — that work is out of scope for this gate.

## 5. Retrieval (diagnostic)

Answerable questions, expected source in the ranked list:

- Top-1 **75%** (67/89)
- Top-3 **84%** (75/89)
- Top-6 **88%** (78/89)

Retrieval is not the only limiter. Several Top-1 hits still produced a Card from a different chunk or failed the span.

## 6. Layout / parser audit

| File | two-col | uncertain | skipped | isolated | notes |
|---|---|---|---|---|---|
| attention.pdf | 0 | 9 | 6 | 3 | Genuine two-column paper not classified two-column |
| bert.pdf | 0 | 16 | 2 | 14 | Isolated-line explosion (781 chunks) |
| resnet.pdf | 0 | 12 | 2 | 10 | Same |
| cs229-notes.pdf | 0 | 28 | 27 | 1 | Math lecture almost empty |
| cisa-ransomware.pdf | 0 | 30 | 0 | 30 | Repeated TLP:CLEAR headers; 945 chunks |
| nist-800-63b.pdf | 5 | 71 | 1 | 70 | 2080 chunks |
| nist-800-207.pdf | 5 | 26 | 0 | 26 | 1154 chunks |
| bitcoin.pdf | 0 | 2 | 1 | 1 | Mostly single-column, usable |

Production ingest **refuses** a PDF with more than 200 document chunks. Blind bench indexed uncapped chunks (honest upper bound on retrieve collisions). Files that parse `ready` but would refuse at ingest: bert, cisa, lora, nist-800-207, nist-800-63b, omb, resnet, tracemonkey.

Would survive the 200-chunk cap alone: attention, bitcoin, cs229-notes, nist-800-145.

## 7. Viewer metrics (spoken release Cards)

Synthetic text-layer map (same method as 4A.5 Node bench):

- Wrong-page **0**
- Wrong-text **0**
- Exact highlight **100%** (82/82)
- Item-box 0% · Caption-only 0%

Zero-tolerance viewer gates passed on this Node reconstruction. A full browser highlight pass on every real Card was not re-run after the safety stop.

## 8. Student workflow

20-question mix (lecture + papers + attacks) from the frozen run:

- Useful Cards: **1**
- Safe silence: **2**
- Wrong Cards: **17**

cs229 is not a usable lecture index. **FAIL**

## 9. Meeting / professional workflow

22-question mix (ZTA, OMB, CISA, 800-63B, cloud definition + attacks):

- Useful Cards: **4**
- Safe silence: **7**
- Wrong Cards: **11**

ThreadContext is still not evidence. Follow-ups do not discount document evidence. The session still emits wrong-intent Cards. **FAIL**

## 10. Mixed / large Context

Uncapped ready chunks: **7616** vs context cap **800** and per-PDF cap **200**.

A realistic 5–10 PDF student or meeting Context cannot activate most of this corpus. Incremental text-source behavior from Phase 3 is unchanged.

## 11. Reload / recovery

No new defect. 4A.6 ingest QA and store-ingest tests still cover mid-parse reload, replace-before-activate, reopen Ready, and rebuild from the canonical Blob.

## 12. Privacy

- `shouldRefine` was false on every spoken document Card in the release run
- `craftCard` leaks: **0**
- Document chunks still never enter the refine payload

**PASS**

## 13. Mobile

Not re-run in 4A.7 after the safety stop. Do not treat as a ship pass.

## 14. Performance

First real-paper parse (attention.pdf) ≈ **515 ms** in Node. Later short PDFs 20–90 ms. 80-page 800-63B ≈ 191 ms. UI Reading → Ready from 4A.6 is unchanged. No worker optimization.

## 15. Failure taxonomy

See `failure-taxonomy.json`. Dominant layers:

1. Evidence gate admits lexically tempting unanswerable questions
2. Wrong-document Cards when several real PDFs share vocabulary
3. Uncertain/isolated-line layout → skipped lecture pages and chunk explosion
4. Two-column academic papers not classified as two-column
5. False silence on paraphrase / casual wording
6. Hard limits (pages, chars, scanned, encrypted) behave as designed

## 16. Existing regression gates

| Gate | Result | Artifact |
|---|---|---|
| `npm test` | 195/195 pass | — |
| `npm run lint` | 0 errors (8 pre-existing warnings) | — |
| `npm run typecheck` | pass | — |
| `npm run build` | pass | — |
| Phase 3.5 code baseline | ok, no diffs | `.eval/phase35/` read-only |
| 4A.3 retrieval | Top-1 83% Top-3 83% Top-6 100% | `retrieval-bench-4a7.json` (frozen `retrieval-bench.json` untouched) |
| 4A.4.1 Cards | wrong-intent 0, unsupported 0, hit 22/22, page 100%, location 100%, fabricated 0 | `card-bench-4a7.json` |
| 4A.5 viewer | wrong-page 0, wrong-text 0 | `viewer-metrics-4a7.json` |
| 4A.6 ingest QA | not re-run this turn; prior 16/16 frozen | `.eval/phase4a/ingest/` |

## 17. Release matrix

See `release-matrix.md`.

## 18. Recommendation

**KEEP COMING SOON**

Do not remove the landing pill. Do not begin 4A.8 or any later format work.

Section 28 stop: safety cases are saved in `card-run.json` `safetyFail` and `failure-taxonomy.json`. No architectural fix was applied on this corpus.
