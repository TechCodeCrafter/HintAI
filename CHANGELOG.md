# CHANGELOG

Record of changes to MeetHint. Oldest first.

---

## 2026-10-02

**Branch:** `fix/dev-server-windows`

### Fixed

**App could not start on Windows** - `a2784cd`

`npm run dev` failed with `spawn vite ENOENT`. The app-env wrapper at
`scripts/with-app-env.mjs` called `spawn` with the command `"vite"`. Windows only
ships `vite.cmd`, a batch file, and `spawn` without a shell searches for an
extensionless executable. Four scripts were affected: `dev`, `build`, `preview`
and `build:dev`.

Fixed by adding a `spawnPlan` helper that routes bare bin names through `cmd.exe`
by path. macOS and Linux behaviour is unchanged.

Two alternatives were rejected first. `shell: true` broke three tests because
`cmd.exe` split `C:\Program Files\nodejs\node.exe` on its space. Spawning `.cmd`
directly is blocked by Node since CVE-2024-27980.

### Changed

**Vite bumped** 8.2.0 to 8.3.2 - `ec00330`

Lock file pruned 426 entries. No source change.

**Merged to main** - `31283d7` (PR #86)

### Verification

| Check | Result |
|---|---|
| `npm run dev` | Vite starts, all routes HTTP 200 |
| SSR document title | `MeetHint - Real-time answers for technical conversations` |
| SSR `og:title` | `MeetHint - Know before you answer` |
| Auth sign-up, sign-in, session | all HTTP 200 |
| `npm run typecheck` | clean |
| `npm test` | identical to baseline |
| `eslint scripts/with-app-env.mjs` | clean, exit 0 |

---

## 2026-10-03

**Branch:** `fix/dev-server-windows`

### Fixed

**`/app` deadlocked on "Loading Knowledge Space..."** (not yet committed)

`src/routes/app.tsx` refused to render `Cockpit` while `contextStatus` was
`"booting"` or `"hydrating"`. The store starts in `"booting"` (`store.ts`), and
`Cockpit`'s mount effect is the only caller of `boot()`, which is what clears that
status. Cockpit therefore never mounted, `boot()` never ran, and the page stayed on
the loading message permanently. Each visit remounted the tree, which re-ran the
workspace identity server function and the ASR worker warm-up, so the
`resolveWorkspaceIdentity` call and the worker CSP violation repeated on every
navigation.

`Cockpit` now renders regardless of `contextStatus`. It already subscribes to
`contextStatus` and `contextUpdating` and renders its own indexing note, so the
loading state is still surfaced.

**Repeated workspace identity fetch on authenticated routes**

`useCurrentUserState` built a new `user` object on every call. The effect in
`useAccountVaultReady` depends on it, so it re-ran each render and re-fetched
without settling. The `user` object is now memoised on its primitive fields.

**Cockpit re-rendered on every live caption**

`cueSearch` read `s.liveDraft`, which is rewritten on every interim caption and
oscillates between empty and partial text at segment boundaries. The derived
boolean flickered, re-rendering the whole cockpit including the file viewer. It now
derives from `utterances`, which is append-only.

**ASR worker retried a permanently blocked import**

`local-asr.ts` reset its cached promise on every failure, so each attempt spawned a
fresh worker that hit the same blocked CDN import and wrote another `asrNote` to the
store. Local ASR is now gated behind `VITE_LOCAL_ASR`, off by default.

**Unwanted symbol removed from the enterprise landing page** - `74100d8` (Pratik Sinha)

The section sign was rendering in citation text, showing `§4.2 · p.17` instead of
`4.2 · p.17`. One timing label was emptied and a file name corrected from
`enterprise-sla.pdf` to `enterprise.pdf`.

`src/components/meethint-landing-enterprise.tsx`, 4 lines changed.

### Known issues, not fixed

**Local Whisper cannot load under the app Content-Security-Policy.**
`public/meethint-asr-worker.js:39` imports transformers from `cdn.jsdelivr.net`,
which is deliberately absent from the app CSP and asserted as removed by
`scripts/domain-reputation.test.mjs` and recorded in `docs/DOMAIN-REPUTATION.md`.
Transcription falls back to the browser `SpeechRecognition` path. The fix is to
bundle a local copy of the transformers runtime into the worker so the import is
same-origin. That changes the security posture, so it needs team agreement.

### Removed

**`.cursor/` folder, 56 files** (not yet committed)

Cursor rules and skills for accessibility, brand, frontend and git conventions,
plus a UI/UX skill carrying 46 data files for 20 frameworks.

The Cursor attribution guard is kept: the strip and check scripts, both git hooks,
the `package.json` entry and the CI check all remain.

**40 one-off diagnostic scripts** (not yet committed)

Leftovers from debugging sessions that already finished.

| Group | Count | Examples |
|---|---|---|
| PDF layout debugging | 8 | `pdf-4a8-analyze`, `pdf-4a9.1-structure` |
| PDF benches and diagnostics | 9 | `pdf-twocol-diag`, `pdf-release-gate` |
| Completed phase | 3 | `phase35-browser-qa`, `phase35-freeze` |
| Audio and gate tuning | 9 | `passb-sweep`, `starve-diag`, `onset-probe-qa` |
| Eval and bench | 8 | `eval-hybrid-retrieval`, `coverage-bench` |
| Screenshots and QA | 3 | `architecture-shot`, `landing-shots` |

`scripts/` reduced from 124 files to 84.

### Changed

**Dev server port moved from 8080 to 3001** - `package.json`

The `dev` script default changed from `--port 8080` to `--port 3001`. Port 8080
was unusable on developer machines running a local Postgres.

Two references still hardcode 8080 and must be updated with this change:

| File | Line | Reference |
|---|---|---|
| `.github/workflows/test.yml` | 28 | CI polls `http://127.0.0.1:8080/__app-env` to wait for the dev server |
| `startup.sh` | 5 | Health-checks `http://127.0.0.1:8080/` |

**`baseUrl` removed from `tsconfig.json`**

TypeScript 7 removes the option outright and errors with TS5102. It was only
serving as a resolution root here, never as a `paths` prefix, because `paths`
already carries the full tsconfig-relative prefix in `"@/*": ["./src/*"]`.
Removing it changes no import resolution. No other option in the config is
affected, `moduleResolution: "bundler"` and `target: "ES2022"` are both valid
in TypeScript 7.

**`db:migrate` now reads `.env`** - `package.json`

Plain Node does not read `.env` files; only Vite does. That is why the dev server
saw `DATABASE_URL` while standalone scripts did not. Now uses
`node --env-file=.env`, matching the existing `flight:capture` and
`eval:truth-judge` scripts.

`.gitignore` - added `.tmp-notes`, removed 4 entries for the deleted `.cursor/`
folder.

### Kept

| Kept | Reason |
|---|---|
| 18 `scripts/*.test.mjs` | Discovered by glob in `run-tests.mjs`, not by filename |
| `grok-pwa-shared.d.mts` | Type declaration for `grok-pwa-shared.mjs` |
| `db-url.mjs`, `production-smoke-setup.mjs`, `verify-beta-diagnostics.mjs`, `context-persist-qa.mjs` | Awaiting a decision |

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` scripts suite | 230 tests, 217 pass, 13 fail |
| `npm test` src suite | 751 tests, 741 pass, 10 fail |
| `package.json` script paths | all resolve |

Test counts match the pre-change baseline.

---

<!-- Template for the next entry -->

## YYYY-MM-DD

**Branch:** `branch-name`

### Fixed

| Change | Commit | Author |
|---|---|---|
| | | |

### Removed

### Changed

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | |
| `npm test` | |