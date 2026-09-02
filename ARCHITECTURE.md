# MeetHint — architecture

*Generated from the repository as it stands. Every claim below was checked against
the code; where something is aspirational or not yet true, it says so.*

---

## 1. What this is

MeetHint listens to a meeting, notices when someone asks a question about material
you have loaded, finds the answer in that material, and shows you a short line to
say — with the file and line it came from.

The product claim is narrow and load-bearing:

> **Nothing is generated. Every spoken word is a word your material already wrote,
> and the citation points at where it wrote it.**

There is no language model in the answer path. A "Card" is an extracted sentence
plus the coordinates of that sentence. When the material does not answer the
question, MeetHint says nothing — silence is a designed output, not a failure.

The default configuration runs entirely in the browser: your files are read with
the File API, indexed in memory, and never uploaded. Speech is transcribed
on-device by Whisper compiled to WebAssembly. An optional server transcription
path is inert unless `XAI_API_KEY` is set — see §11. Search never calls a model.

---

## 2. The two guarantees

Every design decision below follows from two promises a Card makes:

1. **These words are in your material.** Enforced at runtime by a word-level
   support check against the exact evidence, on every Card, not offline on a
   sample.
2. **Here is where.** Enforced by an evidence model that records measured
   coordinates and refuses to invent any.

A claim that cannot produce valid evidence cannot speak. That rule has one
implementation and no exemptions — including for the built-in demo pack.

---

## 3. Repository map

```
src/
  routes/            TanStack Start file routes
    index.tsx        /        landing page
    app.tsx          /app     the cockpit (the actual product)
    relay.tsx        /relay   read-only phone view of the current Card
    soon.tsx         /soon    redirect to /
    __root.tsx       document shell
  components/
    cockpit.tsx      three panes: Repo | Room | Card
    meethint-landing.tsx
  lib/
    listen/          audio capture, VAD, segmentation, transcription
    search/          the answer pipeline (see §5–§8)
    repo/            the material model: RepoPack, folder loading, demo pack
    context/         Context persistence (IndexedDB behind ContextRepository)
    ai/              optional xAI paths (off without a key)
    store.ts         zustand store; the whole app's state
    db.ts            Postgres, used only by the waitlist
scripts/             test runner, eval harnesses, browser QA
migrations/          one migration: the waitlist table
```

The answer pipeline is 3,594 lines across `src/lib/search/`, tests aside. The
largest modules are `local-card.ts` (composition, 691), `retrieve.ts` (435),
`question.ts` (the gate, 371) and `evidence.ts` (342).

---

## 4. Listening

### Capture

Two independent lanes, both raw PCM through an `AudioContext` at 16 kHz where the
browser allows it (`src/lib/listen/call-share.ts`):

| Lane | API | Role |
|---|---|---|
| `computer` | `getDisplayMedia({ video: true, audio: true })`, video tracks dropped immediately | always **them** |
| `mic` | `getUserMedia` with echo cancellation and noise suppression | **you** when a tab is shared, otherwise **them** |

The user presses Listen, allows the microphone, and shares a tab *with audio
checked*. If neither stream opens, the attempt fails loudly rather than listening
to nothing.

Each lane runs a `ScriptProcessorNode` (buffer 2048) doing per-frame RMS. An
`AudioWorklet` exists alongside it but only as a diagnostic PCM-loss monitor,
enabled by a test flag.

### Segmentation

Energy-based VAD in `vad.ts`, with the gate for a lane computed as
`max(lane.vad, lane.floor * 1.8)` and a noise floor that only creeps upward while
the lane is idle — a frame is classified before it is allowed to move the floor.
Static bases are `0.024` for the shared tab and `0.013` for the mic.

A ring buffer (`ring.ts`) retains 500 ms of pre-roll so an utterance does not lose
its first word. An utterance ends after 900 ms of sustained quiet, is force-committed
at 7 s, and must contain at least 400 ms of voiced audio to commit at all.
Fragments shorter than that are carried for up to 1.2 s and merged into the next
utterance rather than dropped.

### Transcription

Three paths exist; one is the default.

- **Local Whisper (default).** `@xenova/transformers` in a web worker
  (`public/meethint-asr-worker.js`), ONNX via WASM, trying
  `distil-whisper-small.en` then `whisper-tiny.en`. Warmed on boot. Every
  committed clip goes through this.
- **Browser `SpeechRecognition` (parallel, mic only).** Runs on Chrome and Edge
  for live captions. It cannot hear a shared tab, so it never covers the lane
  that matters most. While it is producing results the mic PCM lane is skipped
  for 1.2 s to avoid double-transcribing.
- **xAI speech-to-text (opportunistic).** Only when `XAI_API_KEY` is set, and it
  falls back to local Whisper on any failure.

### Transcript identity

`transcript-events.ts` deduplicates by **event id, not text**. An id is minted
where the clip is committed. Two people asking a byte-identical question are two
events and both reach the gate; one clip re-transcribed by a slower, better pass
is one event and *rewrites the line it already owns* rather than appending a
duplicate. `applyHeard` returns one of `appended`, `rewritten`, `ignored`, `empty`.

---

## 5. The question gate

`src/lib/search/question.ts`. Only the newest "them" utterance can trigger a Card;
the previous four lines are context and nothing more.

`gateNewest` runs in order and returns one verdict:

1. **`empty`** — nothing left after caption cleanup.
2. **`chatter`** — meeting logistics or pure social framing.
3. Filler is stripped clause by clause; if nothing survives, `chatter`.
4. **`orphan-follow-up`** — a terse follow-up ("Why?", "Then what?") with no open thread.
5. **`not-a-question`**.
6. **`unresolved-reference`** — a reference the thread cannot ground.
7. **`follow-up`** or **`question`**.

The chatter rule is split in two, and the split is the point. **Logistics**
("can you hear me", "next slide", "you're muted") match anywhere in the line,
because nobody embeds them in a technical question. **Filler** ("thanks",
"good morning", "how are you") matches only as a whole clause. Without that
distinction, *"How are you handling retries on the ingest worker?"* is silenced by
the words "how are you" — a real bug this fixed.

### Spoken normalization

`spoken.ts` produces `{ raw, canonical, removed, repairs }`. It strips leading
discourse markers, resolves explicit self-repair ("where's the config — I mean the
*template* config" keeps the correction), and removes hedges only in positions
where they are functioning as hedges. It deliberately **preserves** negation and
existence vocabulary, because "we're not testing this at all, right?" must stay an
absence question.

Only `canonical` is used for classification, subject selection and retrieval. The
raw transcript is never overwritten.

### Thread context

`thread.ts` holds a bounded `ThreadContext`: the last answered question's
canonical text, shape, subject terms, spoken claim, cited files and entities. It
expires 45 seconds after the last answer, and is cleared outright whenever the
material changes (loading a folder, resetting the pack) or the transcript is
cleared. A new self-contained question simply names its own subject, so it never
consults the thread in the first place.

The rule is that **context resolves references; context never becomes the
question.** "And after that?" resolves to *what happens after the previously
described step* and searches for downstream evidence — it does not re-run the
previous question. If a reference has zero or more than one candidate referent,
the verdict is silence. `withdrawReplay` additionally suppresses a follow-up that
would repeat the answer just given.

---

## 6. The answer pipeline

`localCard(query, hits, pack, latencyMs, openFile)` in `local-card.ts`. Retrieval
has already run.

| Stage | Where | What it rejects |
|---|---|---|
| Normalize | `spoken.ts` | — |
| Absence gate | `intent.ts` | existence questions no retrieved text can settle |
| Structural answer | `architecture.ts` | — (tried first for "what is this?") |
| Rank | `retrieve.ts` | low-scoring chunks |
| Extract | `prose.ts` | files that say nothing about themselves |
| Subject admission | `subject.ts` | evidence that sits somewhere relevant and says nothing relevant |
| Score floor | `local-card.ts` | weakly-related claims |
| **Evidence gate** | `evidence.ts` | missing, stale, or unsupported evidence |
| Shape gate | `intent.ts` | right subject, wrong kind of answer |

### Retrieval

`buildChunks` cuts each file into 28-line windows stepping 22 (six lines of
overlap), recording `startOffset` so a chunk can be mapped back into file
coordinates. Each commit becomes one chunk of kind `why`.

Scoring is IDF-weighted with saturating term frequency, `log(1 + n / (1 + df))`,
weighting path matches above body matches and giving a large bonus when a term is
the file's own stem. Results are diversified: at most three chunks per file.

### Shape

`shapeOf` classifies into `what`, `how`, `where`, `why`, `failure`, `absence`,
`who`. `evidenceFitsShape` then decides whether the evidence found is the *kind*
of thing the question asked for:

- **`absence`** is always false. Retrieved text cannot prove a gap.
- **`why`** needs a commit/ADR or prose that actually states a reason.
- **`failure`** needs error-path evidence.
- **`who`** needs authorship — see §8.
- The rest pass.

This runs last, on every compose path, so a future path cannot reintroduce the
failure of answering "why?" with a well-cited description of behaviour. Citations
survive when the claim is withdrawn, so the room still sees where MeetHint looked.

---

## 7. The evidence model

This is the core of the system.

### Exact source mapping (`text-map.ts`)

Extracting a spoken sentence means transforming text: stripping comment markers,
unwrapping hard-wrapped lines, splitting paragraphs into sentences. Every one of
those transformations destroys the link back to the original position.

`Mapped` carries the position through:

```ts
export type Mapped = {
  text: string;
  /** `at[i]` is the offset in the source document of `text[i]`. */
  at: number[];
};
```

Slice, join, trim, split and line-split all preserve the parallel offset array, so
a sentence reassembled from three wrapped lines of a docstring still knows exactly
which byte range of the file it came from. `prose.ts` returns `ProseSpan`s carrying
those ranges rather than bare strings.

### The evidence union (`evidence.ts`)

```ts
type Evidence = TextEvidence | CommitEvidence;
```

It is a tagged union because the two sources MeetHint reads have genuinely
different coordinates, and flattening them is how fabricated provenance gets in.

**`TextEvidence`** — evidence at a known position in a known document:

| Field | Meaning |
|---|---|
| `path`, `sourceType` | which document |
| `startOffset`, `endOffset` | half-open range; `text` is exactly this range |
| `startLine`, `endLine` | 1-based, **derived from the offsets** so they cannot disagree |
| `text` | verbatim source, never normalized |
| `normalizedText` | the same evidence rendered for speech — this is what may be said |
| `contentHash` | of the whole document |

**`CommitEvidence`** — evidence in version history: `sha`, `shortSha`, `message`,
and where recorded `pr`, `author`, `date`, and the files the commit touched. It
has **no `path` and no line fields at all**. A commit message is not written *in*
a file, it is written *about* one, and there is no field to default to `1`.

### Runtime verification

Two checks run before anything is spoken, in `admitEvidence`.

**Currency.** Each kind verifies against its own source. Text evidence must match
the file as loaded — the content hash catches an edit anywhere in the document,
and re-slicing the recorded range catches evidence built against the wrong
document entirely. Commit evidence must match the message history still records,
so an amended or rebased commit invalidates a quote taken from it.

**Word-level support.** Every content word longer than four characters that is
about to be spoken must appear in the evidence cited. Each piece of evidence is
read through its own verifiable surface: for a file that is the source text; for a
commit it is the message plus the recorded author, PR and sha, because those are
recorded facts about the commit rather than inferences from it.

Function words are exempt via a curated `GLUE` list, and each compose path may
declare `structural` vocabulary it drew from the file tree rather than from prose
("work is split across four workers" counts the directories). That allowance is
passed at the call site, so it is visible rather than hidden in a global list.

Failures are recorded as `NO_EVIDENCE_SPAN`, `STALE_EVIDENCE` or
`UNSUPPORTED_CLAIM` in the claim trace, which is what the eval harnesses read.

### Citations

Citations are tagged for the same reason evidence is, and one renderer
(`cite.ts:citationText`) serves every display surface. Real output from the demo
pack:

```
"Why are retries capped?"        docs/adr/0007-exporter-retries.md:8-10
"What is the retry decision?"    Commit a3f91c2 · PR #842
"Who touched the auth flow?"     Commit c4d88aa · PR #640
"Why does that retry three?"     src/exporter/retry.ts:4-6
```

Lines 8–10 of that ADR are exactly the three lines stating the decision, and
nothing else. Before this work the same answer cited the file at line 1.

A commit citation is not clickable, because there is no file to open. The repo
pane highlights only file citations. The inline excerpt renders only for file
citations.

**A Card carries exactly one citation for what it spoke.** Corroboration would
have to be proven rather than assumed, and a second chip the room can click and
find nothing behind is provenance for a claim it does not carry.

---

## 8. Authorship

"Who touched the auth flow?" cannot be answered from prose. A docstring says what
a file does; letting that through is how an authorship question gets answered with
"verifies the session cookie on every non-public request" — cited, true, and not
the question.

The `who` shape is satisfied only when the evidence identifies a person **and the
spoken line names them**. Being a commit is not enough on its own. Prose also
qualifies when it states ownership outright (a CODEOWNERS note, an "owned by" line).

Because the author is recorded provenance, the composed line passes the ordinary
support check with no structural allowance:

> **Who touched the auth flow?**
> "Jordan Lee, in PR #640: auth: rotate session cookies through edge middleware"
> — `Commit c4d88aa · PR #640`

When history records no author, the Card is silent with a reason the room can act
on: *"The material says what this does, not who owns it."*

---

## 9. The material

`RepoPack` is `{ id, name, description, files[], commits[] }`.

Files arrive through a folder picker (`webkitdirectory`) and are read in the
browser with the File API. **Nothing is uploaded.** User folders are persisted in
IndexedDB (Dexie) as a Context plus source rows. File chunks are cached per
source behind a ledger of content hash + chunker version + index version.
Unchanged sources reuse stored chunks; changed or new sources call the same
`buildChunks()` on that file alone. Vocabulary is always rebuilt from the
assembled active set. The search engine still never sees Dexie.

Loading is filtered hard: 35 source and document extensions, at most 160 files,
80 KB per file, 2 MB total, with build output, lockfiles, vendored directories and
binaries dropped. `prunePack` then scores paths and warns when fewer than three
code files survive.

The built-in demo pack is `northstar-payments` in `repo/northstar.ts` — nine files
(a README, an ADR and seven TypeScript modules) and six commits carrying authors
and PR numbers.

**There are no scripted demo answers.** The two remaining references to the demo
pack's id choose which suggested questions to show and which query to prefill; the
answer path has no branch on it. Whatever the demo says is what the engine would
say about anyone's files, under the same support check. This was deliberate: if
extracted wording is less polished than a hand-written script, that is information
about where deterministic composition needs work, and hiding it behind a fixture
would have created two definitions of "supported".

---

## 10. State, routes and persistence

One zustand store (`store.ts`) holds the pack, the retrieval index, the transcript,
the current Card, the ledger of recent answers and the thread context.

`search()` runs: normalize → retrieve → `localCard` → replay guard → set state →
persist. Auto-answered questions from the room take the local path only.

Persistence for material is IndexedDB behind `ContextRepository`
(`src/lib/context/`). Dexie database version 2 keeps the Phase 2 `contexts` and
`sources` tables and adds `indexedSources` (ledger: content hash + chunker
version + index version) and `storedChunks` (Context-scoped reusable file
chunks). Existing Contexts upgrade in place; source rows are never wiped.
`localStorage` keeps only `meethint.session` (the current Card, for the `/relay`
view), `meethint.activeContextId` (which Context is open), and `meethint.waitlist`.
A one-shot read still accepts the old `ground.*` keys and rewrites them.
A one-shot migration reads a legacy `ground.pack`, writes it into IndexedDB,
reads it back, and deletes the key only if file count, paths and hashes match.
Transcript, thread and typed query are deliberately not persisted across a
reload.

Hydration uses the same epoch as Phase 2. A late index for Context A may finish
writing A's cache after B is active; it must not replace B's pack, chunks,
vocab, `activeContextId`, or ready state. Cached index data is an optimization:
a corrupt or missing row rebuilds that source from canonical `StoredSource`
content. Demo commit chunks stay in-memory via `buildChunks(NORTHSTAR)` and are
not persisted.

Search, auto-answer and Listen-triggered search are no-ops while a Context is
booting or hydrating, so a question cannot be answered from the previous pack.

Routes: `/` is the landing page (with a link into `/app`), `/app` is the cockpit,
`/relay` is a read-only phone view polling the session key, `/soon` redirects to
`/`.

---

## 11. Build, deploy and data

- **Stack:** TanStack Start (Router + Query), React 19, Tailwind v4, zustand,
  Vite, Nitro with the Vercel preset. Node 22.
- **`npm run build`** runs the Vite build then applies migrations, which is a
  no-op unless `DATABASE_URL` is set.
- **Auth is off.** The template's Better Auth wiring is present but inactive;
  `AuthProvider` is a passthrough and there are no login routes.
- **The database holds one table**, the waitlist, written by one insert-only
  server function with row-level security enabled so the address list is not
  readable through Supabase's generated REST API. Nothing about a user's material
  touches a database.
- **`XAI_API_KEY`** is optional and unset by default. It enables an optional
  transcription path only. Search does not use it.

---

## 12. Quality

### Tests — 422 total, plus Phase 3 incremental-index tests

| Group | Result |
|---|---|
| `src` (gate, transcript identity, evidence, cards, contexts, index) | **227 / 227** across 21 files |
| `scripts` (platform plugin and harness tests) | **195 / 195** |

Phase 3.6 resolved the eight stale share-card / `og:title` assertions and the three lint errors. This is the clean pre-document-ingestion baseline. Phase 4A must not change these code-path results.

### Benchmarks

**Natural-language holdout** — 30 utterances of real spoken English, held out from
everything used to build the gate, the subject rule, retrieval or the composer:

| Metric | Value |
|---|---|
| Wrong-intent card rate | **0%** (0/13) |
| Unsupported card rate | **0%** (0/13) |
| False-silence rate | 24% (4/17) |
| Supported-opportunity hit rate | 76% |

**Answer coverage** — 30 questions against a real codebase:

| Metric | Value |
|---|---|
| Unsupported card rate | **0%** (0/20) |
| Wrong-intent card rate | **0%** — of 9 unanswerable questions, 0 produced a Card |
| Supported-opportunity hit rate | 95% (20/21) |

**Citation audit** — every citation produced across both packs resolves in the
material it names, and no commit citation renders a coordinate: 22 citations, 0
invalid, 0 fabricated.

**Browser QA** — 13/13 against the dev server and 13/13 against the production
build, identical, with a clean console at desktop and mobile viewports.

---

## 13. Known limitations

Stated plainly, because the product's whole claim is about not overstating.

1. **Commit evidence only exists for the demo pack.** A folder loaded through the
   browser has no git history — `packFromFiles` sets `commits: []`. Authorship
   questions and rationale-from-history therefore work in the demo and not yet on
   a user's own material. Reading history in the browser is the gap to close.

2. **Structural claims are allowed by a declared vocabulary list, not modelled as
   evidence.** "Work is split across four workers" is derived from the file tree
   and permitted through a `structural` allowance at the call site. It is
   auditable but it is not a `StructuralEvidence` type with a counted operation
   and source ids. That modelling is deliberately not built yet.

3. **Search does not generate or refine a spoken line.** The live path is
   retrieve → localCard → admit. Leftover polish/assist helpers and `cardsmith`
   are not called from `store.search()`. A key cannot change what the card says.

4. **Support checking is lexical, not semantic.** A word must appear literally in
   the evidence. "rotated" fails against a message that says "rotate". This is a
   deliberate trade — it makes the check auditable and impossible to argue with —
   but it costs recall on legitimate paraphrase.

5. **"Who owns this?" is answered by who last touched it.** Commit authorship is
   real evidence of authorship, and the citation is exact, but last-toucher and
   owner are not the same thing. CODEOWNERS-style ownership is recognised only
   when prose states it outright.

6. **Four false silences remain on the holdout**, attributed by the harness to
   reference resolution (2), lexical recall (1) and the replay guard (1). None of
   them require embeddings to fix.

7. **PDF, DOCX, PPTX and Sheets are marked Coming soon on the landing page.**
   The folder loader still accepts source and text formats only. Document
   ingestion is a later phase; those formats are not faked.

8. **The document-frequency subject rule needs a corpus to be discriminating.** A
   very small pack gives every term a similar document frequency, which weakens
   admission.
