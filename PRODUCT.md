# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19, TanStack Router, Vite, Tailwind CSS v4, Zustand, Dexie/IndexedDB (local corpus), optional PGLite (preview auth/waitlist). Nitro preset for Vercel deploy.

## Users

People in live meetings — office hours, sales calls, incident reviews, contract Q&A — who need a cited line from material they already loaded before the room moves on.

## Product Purpose

MeetHint listens to a meeting, detects questions about loaded material, searches that material locally, and shows a short line to say with file-and-line coordinates — or stays silent with a specific reason.

Success: the user speaks only what their files support; silence is a designed output, not a failure.

## Positioning

**Cite or silence.** Every spoken word is backed by a citation into the user's material, or the card stays empty. There is no general-knowledge tier and no “generate when the files can't answer” path.

## Operating context

- Files are read with the File API and indexed in the browser; user folders are not uploaded by default.
- Free tier: limited cited LLM-backed answers per day; offline exact extraction and silence do not consume quota.
- Pro: unlimited cited answers, Claim Audit across a meeting.

## Accessibility

Keyboard-first cockpit (Search, Listen, overlay). Live captions and cited cards must remain readable in dark and light themes. Design QA uses axe-core in Playwright; product contract tests guard copy.

## Voice and terminology

- Product name: **MeetHint** (`meethint.ai`)
- Contract phrase: **Cite or silence** / **Cite it, or stay silent.**
- Never promise answers from general knowledge or generation when files cannot answer.

Canonical product nouns (see [ROADMAP.md](./ROADMAP.md)):

- **Workspace** — account/team boundary
- **Knowledge Space** — grouped sources for a project/domain
- **Source** — repo, doc, or future connector unit
- **Session** — live conversation
- **Answer** — cited or silent Card output

Legacy terms (*pack*, *context*, *material*) are being retired from user-facing copy.

## Evidence and constraints

- Pipeline: retrieve → grounded synthesis (verified citations) → localCard → silence (`answer-route.ts`).
- Git-history answers ship on the built-in demo pack only; user-loaded folders are files without commit metadata today.
- PDF ingestion has page/size limits; scanned PDFs are not supported yet.
