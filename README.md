# MeetHint

Browser meeting copilot for live calls. Load your material once. When someone asks a question, MeetHint searches what you loaded and shows a short line to say — with the file and line it came from.

**Cite or silence.** Every spoken word is backed by a citation into your material, or the card stays empty with a specific reason. There is no general-knowledge tier and no “generate when the files can’t answer” path.

This is not a thin RAG wrapper. The search layer alone is ~3,600 lines across 60+ modules under `src/lib/search/` — hybrid retrieval, an evidence model with byte-level coordinates, shape-aware admission, offline exact extraction, and LLM-assisted synthesis that must pass citation verification before it can speak.

For the full design (listening, persistence, benchmarks, known gaps), see **[ARCHITECTURE.md](./ARCHITECTURE.md)**. For build order and vocabulary, see **[ROADMAP.md](./ROADMAP.md)**. For tenant isolation and RLS decisions, see **[docs/TENANT-ISOLATION.md](./docs/TENANT-ISOLATION.md)**. For adversarial red teaming, see **[docs/RED-TEAM.md](./docs/RED-TEAM.md)**.

---

## The product loop

This is the only loop that defines whether MeetHint works:

1. **Hear** the other person ask a question on a live call.
2. **Retrieve** against the material you loaded.
3. **Show** the right cited line on a second screen before the room moves on.

**What works today:** share the meeting tab with audio checked + laptop mic; **Chrome or Edge**; on-device Whisper ASR; Search fires on questions; **O** opens overlay on a second monitor; `/relay` mirrors the Card on a phone. There is no embedded Zoom/Meet preview — you share the tab yourself.

**Not the product yet** (in the repo, not proven on the loop): Better Auth (inactive passthrough), Pro/billing modals (waitlist only — no Stripe), multiplayer P2P scaffold, Remotion demo renders, Postgres/PGlite (waitlist insert when `DATABASE_URL` is set). Auth and upgrade chrome do not substitute for hear → cite → second screen in under two seconds on a real call.

---

## What you get on a call

| Surface | What it does |
|---|---|
| **Room** | Live transcript from tab audio + mic; questions trigger Search automatically |
| **Card** | A cited line from your files, or silence with a reason |
| **Repo** | The loaded pack — files, commits, citations you can open in-place |
| **Claim Audit** (Pro, waitlist) | Side path — tracks claims against your material; not part of the core loop |

Keyboard: **S** / **Ctrl/Cmd+K** Search · **L** Listen · **O** overlay for a second monitor (the second-screen path).

---

## The answer pipeline

`store.search()` normalizes the question, retrieves evidence, then routes through a fixed pipeline (`answer-route.ts`):

```
spoken question
  → hybrid retrieve (lexical + semantic + structural, pack exclusions at query time)
  → generateAnswer      grounded: cited + verifyClaim, or INSUFFICIENT
  → synthesizeAnswer    cited synthesis only — uncited output discarded
  → localCard           offline exact extraction (free, always cited)
  → silence             specific reason: no hits, uncovered, transport error
```

An optional model key helps combine passages **from numbered chunks only**. If the model returns no verifiable citations, the pipeline falls through to offline extraction or silence. `localCard` success and silence never consume the free-tier daily quota; only a cited LLM-backed answer does.

---

## Retrieval

Chunks are built per file (28-line windows, six-line overlap; structured chunks for code when enabled). Commits become `why` chunks with author and PR metadata.

**Hybrid scoring** merges three channels (`retrieve.ts`, `hybrid.ts`, `semantic-retrieve.ts`):

| Channel | Signal |
|---|---|
| **Lexical** | IDF-weighted term frequency; path matches weighted above body; filename stem bonus |
| **Semantic** | Local embeddings (`embedding.ts`) over chunk text; scores fused via `retrieval-weights.ts` |
| **Structural** | Named paths, file stems, and symbol names from the query |

Results are diversified (at most three chunks per file). Pack exclusions drop boilerplate at query time; the vector store in IndexedDB (`vector-store.ts`, `context/storage/vector-store-indexeddb.ts`) is updated incrementally when sources change.

Retrieval traces (`retrieval-trace.ts`, `retrieve-trace.ts`) record which channel won each hit — useful when debugging false silence.

### Retrieval rank vs verification (two philosophies, one contract)

Hybrid retrieval mixes **lexical IDF** (exact-term recall) with **embedding similarity** (semantic recall). They only change which chunks become candidates. They do **not** change what may speak:

- Semantic search never writes a line (`embedding.ts`, `semantic-retrieve.ts`).
- Every speak path calls **`verifyClaim`** — spoken words must appear literally in the evidence (`evidence.ts`).
- Subject, shape, and evidence gates run after retrieve, on every compose path.

So semantic retrieve can fix recall (surface a chunk lexical missed) but cannot make the card say something the files only “kind of” contain. Paraphrases like “rotated” against evidence that says “rotate” still fail the support check and stay silent. If hybrid recall improves, keep the verifier brutal — do not soften it to match embeddings.

---

## Composition and evidence

Before anything speaks, the composer runs a stack of gates (`local-card.ts`, `evidence.ts`, `subject.ts`, `intent.ts`, `prose.ts`):

1. **Subject admission** — evidence must mention what was asked about, not just sit in a relevant file.
2. **Shape** — `what` / `how` / `where` / `why` / `failure` / `who` / `absence`; wrong-shape evidence is withdrawn even if cited.
3. **Evidence gate** — every claim carries `TextEvidence` or `CommitEvidence` with measured coordinates (`text-map.ts` preserves byte offsets through unwrap and sentence split).
4. **Support check** — spoken words must appear literally in the evidence (auditable, not semantic fuzzy match).

When composition rejects a candidate, **`claim-trace.ts`** records why (`SCORE_FLOOR`, `WRONG_SHAPE`, `NO_EVIDENCE`, …). Silence is typed, not a generic empty card.

Thread context (`thread.ts`) resolves follow-ups (“and after that?”) without re-running the previous question as the query.

---

## Listening

Two PCM lanes at 16 kHz: shared tab audio (them) and mic (you, or them when no tab). Energy VAD with pre-roll ring buffer, fragment merge, and force-commit at 7 s.

Default transcription: **Whisper in a Web Worker** (`@xenova/transformers`, ONNX/WASM). Browser `SpeechRecognition` runs in parallel on supported engines. Optional server path exists but is off without `XAI_API_KEY`.

Details: ARCHITECTURE §4.

---

## Local-first

- Material is read with the **File API** and indexed in **IndexedDB** (Dexie). Nothing is uploaded.
- Contexts, sources, chunk cache, and the embedding index stay on device.
- Postgres (when `DATABASE_URL` is set) holds **only the waitlist** — one insert-only table.

---

## Tiers

| | Free | Pro |
|---|---|---|
| Search | Cite-or-silence, 20 cited LLM answers / local day | Unlimited cited answers |
| Claim Audit | — | Meeting claim tracking + export |
| Offline `localCard` | Free | Free |

---

## Repository map

```
src/
  components/cockpit.tsx       Repo · Room · Card
  lib/search/                  answer pipeline (retrieve → route → compose)
  lib/listen/                  capture, VAD, transcription
  lib/context/                 IndexedDB contexts, chunk cache, vector index
  lib/audit/                   Claim Audit admit + report
  lib/repo/                    RepoPack, folder load, demo pack (northstar)
  lib/store.ts                 zustand — pack, transcript, card, search
```

Key search modules: `retrieve.ts` · `hybrid.ts` · `semantic-retrieve.ts` · `vector-store.ts` · `generate-answer.ts` · `local-card.ts` · `evidence.ts` · `answer-route.ts`.

---

## Run

```bash
npm i
cp .env.example .env
npm run dev          # http://localhost:8080
```

```bash
npm test             # 780+ unit tests (src + scripts)
npm run typecheck
npm run test:e2e     # 15 Playwright specs (needs: npx playwright install chromium)
```

Load a **service folder** (`src/`, not the repo root) for best recall.

### What you can cite today

| Source | How to load | Notes |
|---|---|---|
| Code, markdown, text | Folder or file upload | Primary path; line citations |
| DOCX, XLSX, CSV, PPT, PPTX | Folder or file upload | Extracted to plain text; file + line cite |
| PDF | **Add PDFs** (separate from folder pick) | Page citations; size/page limits; scanned PDFs fail |

**Git history** (who touched a file, rationale from a PR) works on the built-in **`northstar-payments`** demo pack only. Folders you load in the browser have no commit metadata — don't expect authorship answers from your own corpus until history ingestion ships.

Suggested demo questions are prefilled; answers use the same pipeline as your files, not hand-written scripts.

---

## Stack

TanStack Start · React 19 · Tailwind v4 · zustand · Dexie · Vite · Nitro (Vercel preset) · Node 22

Optional: `@xenova/transformers` (local ASR + embeddings), provider API keys in-browser for cited synthesis only.

---

## Routes

| Path | Purpose |
|---|---|
| `/` | Landing |
| `/app` | Cockpit |
| `/create` | New context + folder upload |
| `/relay` | Read-only phone view of the current Card |
