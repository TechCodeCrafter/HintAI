# Phase 3.5 frozen baseline

Frozen 2026-08-30. Do not start Phase 4 against a different quality or Card snapshot.

## Phase 3.6 baseline hygiene (2026-08-30)

The repository-level test/lint debt recorded at freeze is resolved. No retrieval, evidence, composition, persistence, incremental indexing, or UI behavior changed.

| Gate | At 3.5 freeze | After 3.6 |
|---|---|---|
| `npm test` scripts group | 187/195 (8 stale share-card / `og:title` assertions from before the MeetHint rename) | **195/195** |
| `npm test` src group | 227/227 | 227/227 |
| `npm run lint` | 3 errors (`prose.ts` `no-control-regex`, `db-url.mjs` `no-control-regex`, `client.server.ts` `no-empty`) | **0 errors** |
| `npm run typecheck` | pass | pass |
| `npm run build` | pass | pass |

Share-card tests now assert the current intended MeetHint identity (`site.json` title + on-disk custom card). Placeholder-color and entity-escape contracts are still covered against an empty cwd so they do not depend on this app's branding. Lint fixes are equivalent (`RegExp` constructors for sentinel / CSI sequences; commented empty `catch`).

Headline quality re-checked after hygiene, unchanged:

- Wrong-intent 0% · Unsupported 0% · False silence 24% (4/17) · Coverage 95% (20/21) · Fabricated citations 0 (claim-support 4/4)

This 3.6-clean state is the **pre-document-ingestion baseline**. Phase 4A (and later document work) must compare against `.eval/phase35/` quality and Card snapshots. Do not overwrite this file. Code-only questions on the eval pack must remain identical.

## Quality

| Metric | Value |
|---|---|
| Wrong-intent | 0% (0/13 holdout unanswerable leaks; 0/9 coverage) |
| Unsupported | 0% (0/13 holdout; 0/20 coverage) |
| False silence | 24% (4/17 holdout) |
| Coverage | 95% (20/21) |
| Fabricated citations | 0 (claim-support 4/4; holdout supported 13/13) |

Holdout silent-but-answerable (unchanged):

- "Basically, what owns this flow?" — unresolved-reference
- "So this service is doing all of it?" — unresolved-reference
- "So the in-memory repo — what's that for?" — LOW_OVERLAP
- "So where is that stored?" — REPLAY WITHDRAWN

## Fresh vs cached (rdb-labsai-backend, 160 files, 1998 chunks)

- Fresh rebuild: 160 sources, 1998 chunks
- Warm reuse: 160 sources, 1998 chunks, 0 rebuilt
- Runtime chunks equivalent
- All 30 coverage-bench Cards identical (say, query, evidence kind/text/span, citations, silence)

Artifacts: `cards-fresh.json`, `cards-cached.json`, `retrieval-fresh.json`

## Incremental mutation (same 160-file Context)

| Operation | reused | rebuilt | new | deleted |
|---|---|---|---|---|
| No changes | 160 | 0 | 0 | 0 |
| One file changed | 159 | 1 | 0 | 0 |
| One file added | 160 | 1 | 1 | 0 |
| One file deleted | 160 | 0 | 0 | 1 |
| 16 files changed | 144 | 16 | 0 | 0 |

Excel export Card unchanged when a non-Excel source changed.

## Cache corruption

Canonical `StoredSource` content survived. Affected source rebuilt. Context ready. Excel question still answered.

## Performance

### Current user-ingestion capacity

Folder loader still caps at 160 files, 80 KB/file, 2 MB total. Not changed.

Worst practical ingest (160 files, 1.64 MB, 959 chunks, in-memory):

- Cold: 13.3 ms (chunk 1.7, vocab 11.4)
- Warm 0-change: 10.9 ms (chunk 0, vocab 10.5)

Real evaluation Context (160 files, 1998 chunks):

| Run | hydrate | cache | chunk | assemble | vocab | total | reusedS | rebuiltS | reusedC | rebuiltC |
|---|---|---|---|---|---|---|---|---|---|---|
| Memory cold | 0.8 | 0 | 4.3 | 4.3 | 18.3 | 23.4 | 0 | 160 | 0 | 1998 |
| Memory warm p50/p95 | 0.7 | 0.2 | 0 | 0.4 | 17.9 | 19.0 / 19.4 | 160 | 0 | 1998 | 0 |
| Memory 1 changed | 0.7 | 0.1 | 0.04 | 0.3 | 17.9 | 19.0 | 159 | 1 | 1980 | 18 |
| Memory 10% | 0.7 | 0.1 | 0.4 | 0.6 | 18.4 | 19.8 | 144 | 16 | 1759 | 240 |
| Memory 100% | 0.7 | 0 | 3.1 | 3.2 | 18.7 | 22.7 | 0 | 160 | 0 | 2003 |
| IndexedDB cold | 2.1 | 0 | 94.1 | 94.1 | 18.1 | 114.5 | 0 | 160 | 0 | 1998 |
| IndexedDB warm p50/p95 | 2.1 | 22.8 | 0 | 22.9 | 20.1 | 37.5 / 45.6 | 160 | 0 | 1998 | 0 |

IndexedDB warm is ~3× faster than cold (114 ms → 38 ms). Vocab rebuild is the remaining in-memory cost.

Northstar files-only (no commits): cold 0.21 ms, warm p50 0.07 ms.

### Index architecture capacity

1,000-source tiny synthetic (skipPrune, in-memory): cold 3.1 ms, warm 3.6 ms, 1000 reused. Wall time is not the story on two-line files; reuse counts are.

## Representative Cards

Northstar chips: `northstar-chips.json`

- Architecture → README.md:3-4
- Exporter change → format.ts (file + PR)
- Retry three times → retry.ts:4-6
- Who touched auth → Commit c4d88aa · PR #640 (no file line)

Eval Excel: "Generates Excel files in the required format for Synthes biocompatibility data" · `services/excel_output_generator.py:3`

## Screenshots

`screenshots/phase35/01` … `11` plus `results.json` (58/58 browser checks).
