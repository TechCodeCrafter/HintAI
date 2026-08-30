# Phase 4A — PDF ingestion design

Approved directionally 2026-08-30. **Revised** the same day with the ten corrections below. Do not implement 4A.1 against the pre-revision chat draft.

Compare code-only behavior against `.eval/phase35/`. Do not overwrite that baseline.

Out of scope: OCR, DOCX, PPTX, XLSX, Tree-sitter, embeddings, Orama, vector search, reranking, generated answers, cloud storage, Drive/Notion/GitHub, collaboration, desktop app.

---

## Revision log (apply before 4A.1)

1. Evidence keeps `sourceText` (verbatim items), `supportText` (deterministic normalize of those items only), `spokenText` (Hint). Support checks spoken against **supportText**. Currentness checks **sourceText** / `itemRanges` against the PDF.
2. Mapping is a discriminated `MappedSegment` union. Inserted whitespace is never attributed to a PDF item.
3. Scan detection is item-presence, not text density. Sparse slide decks stay readable.
4. Uncertain reading order and dense grids are skipped or isolated. No large `stream` prose chunks.
5. If the local winning Card has `DocumentEvidence`, skip the optional xAI refine pass entirely.
6. `SourceLookup.document(sourceId)`. Path is display metadata.
7. Preferred highlight is item + character range in the text layer. Boxes are an explicit approximate fallback. Failed map → page + caption, no fuzzy highlight.
8. Warm hydration restores `DocumentChunk`s only. Blobs and `NormalizedDocument`s load on demand.
9. Resource limits are bytes / pages / extracted characters / chunks / parse cost. File-count is a temporary defensive cap, not a Context invariant.
10. A Context is not Ready while required PDF work for that activation is incomplete. Searchable snapshot is atomic.
11. `NormalizedPage` retains raw `PdfTextItem[]` (`item.str` + geometry). Currentness reconstructs `sourceText` from `items[itemIndex].str` without reparsing the PDF.
12. `DocumentEvidence` carries `parserVersion` and `normalizerVersion`. Version mismatch invalidates evidence even when PDF bytes are unchanged. `DOCUMENT_CHUNKER_VERSION` is not part of evidence currentness.
13. Canonical bytes are keyed by `sourceId + contentHash`. An in-flight update stages `NEW_HASH` while the active snapshot still resolves `OLD_HASH`. Swap only when the new activation is complete. GC unreferenced revisions after that.
14. `readingOrder` includes `"uncertain"`. An uncertain page is never labeled single-column. `index` remains `full | isolated-lines | skipped`. Still no `"stream"` mode.

---

## 1. Library

**`pdfjs-dist` (Mozilla PDF.js)**, parse and render in the browser.

Same engine for extract and viewer. Real `pageNumber`. `getTextContent()` items carry `str`, `transform`, width, height. Vite worker via `?url`. No server upload.

Pin the package version; that pin is `PDF_PARSER_VERSION`.

Not chosen: unpdf (hides items), pdf-parse / Python (server), pdf-lib (write), mupdf.wasm (no shared text layer).

---

## 2. What must change vs what must not

**Must change (text-shaped assumptions):** `StoredSource.content: string`, `hashContent` on UTF-8, `SourceDraft`, `packFromSources`, `fingerprintPack`, `file.text()` / `looksText()`, `RepoFile` as the only pack member, `buildChunks` line windows, `TextEvidence` lines, `FileCitation` / `citationText` `path:line`, `RepoPane` numbered `<pre>`, `isUsableChunk` requiring `code|why` + `startLine`, `rebuildSource` → `chunksFromFile` only, `replaceSources` as the only write (folder stays replace; add-files needs `upsertSources`).

`sourceTypeOf(".pdf") === "pdf"` already exists on `TextEvidence`. **Do not put PDF claims in `TextEvidence`.**

**Must not change:** gate, spoken normalize, thread, subject, `tokenize` / IDF / retrieve weights, `GLUE`, code `buildChunks`, `CHUNKER_VERSION`, `TextEvidence` / `CommitEvidence` / file and commit citation rendering, folder picker / `ALLOW_EXT` / 160 · 80 KB · 2 MB, Northstar, eval pack, Phase 3.5 artifacts, auth/DB off, `ContextRecord` field shape.

`retrieve()` already limits the head-of-file bonus to `kind === "code" && startLine <= 8`. `kind: "document"` must not grow a fake `startLine`.

---

## 3. StoredSource

```ts
type StoredSource = TextStoredSource | PdfStoredSource;

type TextStoredSource = {
  id: string;
  contextId: string;
  path: string;                 // display / tree
  language?: string;
  kind: "file";
  byteLength: number;
  contentHash: string;          // SHA-256 of UTF-8 bytes
  content: string;
  createdAt: number;
  updatedAt: number;
};

type PdfStoredSource = {
  id: string;
  contextId: string;
  path: string;                 // display only
  kind: "pdf";
  mimeType: "application/pdf";
  byteLength: number;
  contentHash: string;          // active snapshot SHA-256
  stagedContentHash?: string;   // candidate revision; not searchable until swap
  pageCount?: number;
  readiness: "pending" | "ready" | "scanned" | "unreadable";
  readinessNote?: string;
  createdAt: number;
  updatedAt: number;
};

type SourceBlobRecord = {
  id: string;                   // `${sourceId}:${contentHash}`
  contextId: string;
  sourceId: string;
  contentHash: string;
  blob: Blob;
};
```

Canonical bytes live in **`sourceBlobs`**, keyed by **`sourceId + contentHash`**, not by `sourceId` alone. Metadata listing never materializes bytes. Two revisions of the same source may coexist while an activation is in flight.

`kind: "file"` remains text/code. PDFs are `kind: "pdf"`.

`SourceDraft` is a union: text `{ path, language?, content }` vs PDF `{ path, kind: "pdf", blob, mimeType }`.

---

## 4. Normalized document and mapped segments

Parser output is not searchable. Search sees `NormalizedDocument` only.

```ts
type NormalizedDocument = {
  sourceId: string;
  path: string;
  contentHash: string;
  type: "pdf";
  parserVersion: number;
  normalizerVersion: number;
  pageCount: number;
  outline: PdfOutlineItem[];    // getOutline(), dest resolved or omitted
  pages: NormalizedPage[];
  readiness: "ready" | "scanned" | "unreadable";
};

type PdfTextItem = {
  itemIndex: number;
  str: string;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
};

type NormalizedPage = {
  pageNumber: number;           // PDF.js 1-based
  text: string;
  items: PdfTextItem[];         // raw PDF.js items; currentness reads item.str
  segments: MappedSegment[];
  readingOrder: "single-column" | "two-column" | "uncertain";
  usefulItemCount: number;      // meaningful source items, not char density
  index: "full" | "isolated-lines" | "skipped";
};

type MappedSegment = SourceSegment | InsertedSegment;

type SourceSegment = {
  kind: "source";
  itemIndex: number;            // getTextContent().items index (stream order, stable)
  sourceStart: number;          // half-open into item.str
  sourceEnd: number;
  normStart: number;            // half-open into NormalizedPage.text
  normEnd: number;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
};

type InsertedSegment = {
  kind: "inserted";
  inserted: "space" | "newline";
  normStart: number;
  normEnd: number;
};
```

Every character of `page.text` belongs to exactly one segment. A normalized character is **source-backed or inserted**. Inserted whitespace has no `itemIndex` and must not duplicate `item.str`.

`itemRanges` reconstruct `sourceText` as the concatenation of `items[itemIndex].str.slice(charStart, charEnd)` on the cached page. That is enough for currentness; do not reparse the PDF.

`itemIndex` is the address in the array PDF.js returned. Layout heuristics must not renumber items.

Join rules (deterministic, versioned with `DOCUMENT_NORMALIZER_VERSION`):

- Insert a space between same-line items when there is a visual gap and neither `str` already supplies it → `InsertedSegment`.
- Insert a newline between visual lines → `InsertedSegment`.
- Soft hyphen: line-final `...[A-Za-z]-` + next line `[a-z]` → omit the hyphen from `page.text` (no invented letters). Both items remain source segments.
- Ligatures: keep `item.str` as decoded. Do not expand unless `str` already is the expanded form.
- Repeated headers/footers (same normalized line, same y-band, ≥50% of pages): omit from `page.text`. Items stay on the raw page list. Not searchable, not cited.

A claim `[normStart, normEnd)` maps to the overlapping **source** segments only. If the range is only inserted characters, refuse the claim.

---

## 5. DocumentEvidence

```ts
type DocumentEvidence = {
  kind: "document";
  id: string;                   // `${sourceId}@p${page}:${normStart}-${normEnd}#${contentHash}`
  sourceId: string;             // canonical
  sourceType: "pdf";
  path: string;                 // display
  page: number;
  sourceText: string;           // verbatim concat of cited item.str slices — no inserted chars
  supportText: string;          // deterministic normalize of those same mapped items only
  spokenText: string;           // extractive Hint
  contentHash: string;          // PDF bytes
  parserVersion: number;
  normalizerVersion: number;
  itemRanges: Array<{
    page: number;
    itemIndex: number;
    charStart: number;
    charEnd: number;
  }>;
  boxes?: Array<{ page: number; x: number; y: number; w: number; h: number }>;
  heading?: string;             // outline title only, dest page known
};

type Evidence = TextEvidence | DocumentEvidence | CommitEvidence;
```

No `startLine` / `endLine`.

| Field | Role |
|---|---|
| `sourceText` | Provenance and currentness. Must reconstruct from current PDF items via `itemRanges`. |
| `supportText` | Word-level support. `verifyClaim(spokenText, supportText)`. Derived only from the cited mapped items, using the same normalizer rules (inserted spaces, safe dehyphenation). Never from extra page context. |
| `spokenText` | What the Card may say. Extractive from `supportText`. |

Currentness does **not** hash extracted text as if it were the file, and does **not** reparse the PDF. It requires all of:

1. cached `NormalizedDocument.contentHash` equals `evidence.contentHash` (and the live source’s active hash, when checking the active snapshot)
2. `parserVersion` matches
3. `normalizerVersion` matches
4. `itemRanges` reconstruct exact `sourceText` from `page.items[itemIndex].str`

A parser or normalizer bump invalidates previously addressed evidence even when the PDF bytes are unchanged. `DOCUMENT_CHUNKER_VERSION` is not part of evidence currentness (it only affects reuse of stored chunks).

```ts
type SourceLookup = {
  file(path: string): string | undefined;
  commit(sha: string): { message: string } | undefined;
  document(sourceId: string): NormalizedDocument | undefined;
};
```

Path is not identity.

---

## 6. Chunks and retrieval

```ts
type DocumentChunk = {
  kind: "document";
  id: string;                   // `${sourceId}:p${page}:${normStart}-${normEnd}`
  path: string;                 // display
  sourceId: string;
  page: number;
  startOffset: number;          // into NormalizedPage.text
  endOffset: number;
  text: string;                 // searchable slice (normalized)
  contentHash: string;
  readingOrder: NormalizedPage["readingOrder"];
  heading?: string;
};
```

`buildChunks(pack)` stays files + commits. New `buildDocumentChunks(doc)`.

`indexContext` concatenates code + commit + document chunks, then `packVocabulary`. Score weights unchanged.

**Boundaries:**

- Indexable region: paragraph (blank visual line) or high-confidence column.
- Cap ~1200 characters; split on sentence end.
- Never span pages.
- Outline heading may attach to following chunks on that dest page. No font-size heading inference.
- Sparse title slide with real items: one chunk is fine.

**Layout (conservative):**

| Layout | 4A action |
|---|---|
| Clear single-column / paragraph | Index as prose |
| High-confidence two-column (two x-clusters, clear gap, similar y-span) | Index left-then-right |
| Dense table / grid (many aligned x and y buckets) | **Do not** flatten to prose. Skip the region |
| Uncertain reading order | Set `readingOrder: "uncertain"`. **Do not** emit a large `stream` chunk and **do not** label the page `single-column`. Skip (`index: "skipped"`) or index **isolated visual lines** (`index: "isolated-lines"`) when a line is independently speakable (≥ one sentence or ≥ 4 words). No cross-line join |

`readingOrder` has no `"stream"` value. `index` does not imply layout: a skipped or isolated-line page that is uncertain stays `"uncertain"`. Silence beats invented adjacency.

---

## 7. Incremental index

```
PDF_PARSER_VERSION = 1
DOCUMENT_NORMALIZER_VERSION = 2
DOCUMENT_CHUNKER_VERSION = 1
```

Do not bump `CHUNKER_VERSION` for PDF work.

PDF reuse: `contentHash` + parser + normalizer + document-chunker + `RETRIEVAL_INDEX_VERSION`, and stored document chunks that pass `isUsableChunk` for `kind: "document"`.

Code reuse unchanged: `contentHash + CHUNKER_VERSION + RETRIEVAL_INDEX_VERSION`.

`IndexedSourceRecord` optional: `parserVersion`, `normalizerVersion`, `documentChunkerVersion` (absent/0 on code rows).

---

## 8. Dexie and lazy load

`DATABASE_VERSION` 2 → 3. No rewrite of text sources. `CONTEXT_SCHEMA_VERSION` stays 1.

| Table | Role | Warm hydrate |
|---|---|---|
| `contexts` | Unchanged | yes |
| `sources` | Metadata only (union, **no blob**) | yes |
| **`sourceBlobs`** | Canonical PDF bytes | **no** |
| `indexedSources` | Ledger + document version fields | yes |
| `storedChunks` | Code and `DocumentChunk`s | yes (chunks only) |
| `normalizedDocuments` | Derived IR + `MappedSegment`s | **no** |

**Canonical:** `sourceBlobs` + `contentHash`.  
**Derived:** `normalizedDocuments` + document `storedChunks`. Always rebuildable.

### When bytes and IR load

| Artifact | Load when | Do not load when |
|---|---|---|
| `DocumentChunk`s | Every warm/index assemble (from `storedChunks`) | — |
| PDF `Blob` | Parse/reparse miss; viewer opens that source | Context list, warm hydrate, retrieve, compose |
| `NormalizedDocument` | `evidenceIsCurrent` for a document-backed Card; viewer/highlighter | Warm hydrate, retrieve scoring |

Repository API must match this: `listSources()` returns metadata (never Blobs); `getSourceBlob(sourceId, contentHash)`; `getNormalizedDocument(sourceId, contentHash?)` (omitted hash = active revision).

Benchmark: 8–24 PDFs already in cache, warm hydrate p50/p95 with blobs **not** read, vs a forced full materialize. Record next to Phase 3.5 IndexedDB warm numbers. A warm path that pulls every Blob is a defect.

---

## 9. Context status and atomic snapshot

`ContextRecord.status` is `indexing` until **this activation** has a complete searchable snapshot.

An activation is one index pass (folder load, add-files, or reopen). Required PDF work for that pass: every accepted PDF is terminal — chunks written (`ready`) or classified `scanned` / `unreadable` (no chunks).

Never:

- UI Ready / search armed on this context
- while
- document chunks for this activation are still being appended

Rules:

1. First load, no prior snapshot: stay `indexing`; do not retrieve against a growing chunk list.
2. Add PDFs to an already-Ready context: keep serving the **previous** snapshot until the new one is complete, then swap. Show updating if needed. Do not search a half-indexed new PDF. Do not mark Ready on the new snapshot early.
3. Late parse after cancel / context switch: persist may finish; must not apply (same epoch rule as Phase 3).
4. `scanned` / `unreadable` are terminal and do not block Ready for the rest of the snapshot.
5. Replacing a PDF’s bytes must not overwrite `sourceBlobs[sourceId:OLD_HASH]` while the active snapshot still cites `OLD_HASH`. Write `sourceBlobs[sourceId:NEW_HASH]`, record `stagedContentHash`, keep `contentHash` on the old revision. `completeContextActivation` swaps metadata to `NEW_HASH` and may GC the old row only when nothing active still references it.

Ready means: the snapshot the UI will search is complete and stable.

---

## 10. Citations and viewer

```ts
type DocumentCitation = {
  kind: "document";
  sourceId: string;
  path: string;
  page: number;
  heading?: string;
  evidenceId?: string;
  label: string;
};

type Citation = FileCitation | CommitCitation | DocumentCitation;
```

Render: `Lecture-08.pdf · Page 18`. Optional ` · "Isolation Levels"` only when `heading` is from outline.

File and commit chips unchanged. `citationOfHit` must not fall through a document chunk to `line: hit.startLine`.

### Highlight

1. Open `sourceId` in `PdfPane` (not the line `<pre>`).
2. Load that source’s Blob; `getDocument`; go to `page`.
3. **Preferred:** `itemIndex + charStart/charEnd` → the matching PDF.js text-layer node, then the exact character range. This is not “paint the item’s bbox.”
4. **Approximate fallback:** whole-item `boxes` from transforms, only if the text layer cannot accept a character range. Treat as approximate in QA (`viewer-highlight accuracy` splits exact vs box).
5. **If mapping fails:** correct page + evidence caption (`supportText` or `sourceText`). **No** fuzzy string highlight elsewhere on the page.

Render one page. Prev/next + “Page N of M.”

---

## 11. Ingestion UX

Folder picker unchanged (`.pdf` stays in `SKIP_EXT`).

```
Add material ▾
  Open folder     → existing
  Add files       → accept application/pdf
```

No context → create one. Current context → `upsertSources`. Same path + hash → no-op. Same path, new hash → **stage** the new Blob revision; do not change the active `contentHash` until `completeContextActivation`.

Scanned / unreadable: listed with the readiness message; not chunked.

No Context dashboard.

---

## 12. Scanned and unreadable

No OCR. No cloud. **Low character density is not a scan.**

A **meaningful text item** is a `getTextContent` item whose `str` contains a word (two or more letters, or a longer token — not empty, not whitespace-only).

| Page | Classification |
|---|---|
| Zero meaningful items | Image-only. Skip. Not a density problem |
| One or more meaningful items, including a sparse title slide | Extractable. Index per layout rules |

| Document | `readiness` |
|---|---|
| Every page image-only | `scanned` — “This PDF appears to contain scanned pages. MeetHint cannot read scanned PDFs yet.” No chunks |
| Mix of image-only and extractable | `ready`. Index extractable pages. Image-only pages skipped. Do not call the whole file scanned |
| `getDocument` throw / encrypted / garbage | `unreadable` |

A slide deck with eight words per page remains readable.

---

## 13. Tables

No table model. Dense grid regions are skipped (not stream-flattened). No row/column claims, no derived totals.

---

## 14. Capacity

Code/folder caps unchanged.

Do **not** put `maxPdfs: 8` on the Context model. Primary budgets:

| Budget | Phase 4A defensive value | Measured in |
|---|---|---|
| Bytes per PDF | 12 MB | file size |
| Pages per PDF | 80 | `numPages`; refuse the file if over (do not silently index 80/200) |
| Extracted characters per PDF | 250_000 | `page.text` lengths |
| Document chunks per PDF | 200 | after chunker |
| PDF bytes per context | 40 MB | sum of PDF `byteLength` |
| PDF pages per context | 400 | sum of accepted `pageCount` |
| Extracted characters per context | 1.5 MB | sum |
| Document chunks per context | 800 | assembled document chunks |
| Concurrent parse | 1 | queue |

**Temporary file-count safety valve:** 24 PDFs per context. Skip further PDFs with the same truncated notice as folder overflow. Raise or drop after the lazy-load bench. Not a product invariant.

Over any budget: skip that file, keep the rest.

---

## 15. xAI / privacy

Default path: PDF bytes, IR, and chunks never leave the origin.

Optional `craftCard` (when `XAI_API_KEY` is set):

1. Do not put `kind: "document"` hits in the refine payload.
2. **If the local winning Card’s evidence includes `DocumentEvidence`, do not call refine at all.** Keep the local Card.

A PDF-backed Hint must not be replaced by a refine that only saw code hits.

The existing code-only refine caveat stays as documented for code. It does not expand to PDFs.

Warm hydrate does not load Blobs; that does not change the privacy story.

---

## 16. Migration

Dexie v3 adds `sourceBlobs` and `normalizedDocuments`; widens TypeScript on `sources` / `indexedSources`. No v2 rewrite.

`packFromSources` ignores `kind === "pdf"` when building `RepoPack.files`.

Runtime: `documents: PdfRuntimeRef[]` (sourceId, path, readiness, pageCount) — not bytes, not extracted text as files.

Folder / Northstar / eval pack: zero PDF rows → index path identical to 3.6.

`fingerprintPack` remains text-file hashes. PDF identity is `contentHash` on the metadata row.

---

## 17. Corpus and tests

Hand-labelled fixtures, never from MeetHint output: single-column lecture, multi-page, two-column paper, bullets, headers/footers, table page, slide deck, manual over 80 pages (refuse), image-only scan, malformed/encrypted.

Labels: `answerable`, expected `sourceId`/page, verbatim span.

Tests when implementation starts: segment coverage (every norm char source or inserted); inserted chars absent from `sourceText`; `supportText` contains the dehyphenated word; support uses `supportText`; currentness uses `sourceText`; no `startLine` on `DocumentEvidence`; citation `path · Page N`; scan ≠ sparse deck; grid skipped; no stream chunk; document Card skips refine; `listSources` / warm hydrate does not read blobs (spy); status stays indexing until activation complete; code `buildChunks` + holdout/coverage identical to 3.6; folder still skips `.pdf`.

---

## 18. Metrics

Keep: wrong-intent, unsupported, false silence, coverage, fabricated citation.

Add (PDF denominator): parse/classification correctness (scanned fixture is a pass if classified scanned; slide fixture is a fail if classified scanned); page citation accuracy; evidence-location accuracy (`itemRanges` → `sourceText`); PDF unsupported **0%**; PDF false silence; viewer-highlight accuracy **split exact character vs box fallback**.

Hard gate: unsupported or fabricated provenance stays 0.

Warm hydrate bench: chunks-only vs accidental full Blob+IR load.

---

## 19. Risks

- Two-column / masters: if confidence is low, skip or isolate. Do not stream-join.
- PDF.js may already insert spaces; they must be `InsertedSegment`s or `sourceText` will not match items.
- Text-layer DOM may not be 1:1 with `getTextContent` items. Prefer item identity then char slice; else box; else caption.
- Hidden junk text on a “scan” (e.g. one “Copyright” item) can make a page look extractable. Meaningful-item rule is still correct vs density; accept rare junk pages over killing slide decks.
- Mixed contexts change retrieval competition. Freeze applies to **code-only** packs.
- Encrypted PDFs: `unreadable` in 4A (no password UI).

---

## 20. Implementation order

| Step | Scope |
|---|---|
| **4A.1** | Types, revision-safe `sourceBlobs`, lookup by `sourceId` (+ hash for bytes/IR), versions, Dexie v3, `upsertSources`, `hashBytes`, status/activation, lazy repository API. Code path only. **Implemented; no PDF parse.** |
| **4A.2** | PDF.js, mapped segments, scan-by-items, skip grid / uncertain order, persist canonical + derived. **Implemented.** |
| **4A.3** | `buildDocumentChunks` into assemble. No score-weight changes. **Implemented.** Retrieval candidates only; no spoken PDF Cards. |
| **4A.4** | Claims, `DocumentEvidence` (`sourceText` / `supportText` / `spokenText`), citations, support vs currentness, **skip refine** on document Cards. **Implemented.** |
| **4A.4.1** | Two-column detection by left-edge clusters; `DOCUMENT_NORMALIZER_VERSION = 2`. **Implemented.** No viewer. |
| **4A.5** | `PdfPane`, exact text-layer highlight, box fallback, caption fallback. |
| **4A.6** | Add files, budgets, readiness copy. Folder picker untouched. |
| **4A.7** | Corpus, metrics, holdout+coverage vs `.eval/phase35/`, lazy-hydrate bench. |

4A.2+ wait on a green 4A.1 gate. Do not begin 4A.2 until that gate is accepted.
