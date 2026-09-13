# MeetHint

Browser meeting copilot for live calls. Load a folder. Ask a question. The card speaks only what your files can cite — or stays empty with a reason.

## How it works

1. Pick a folder (code, docs, contracts). Stays in your browser, never hits a server.
2. Ask a question in the Room.
3. MeetHint retrieves, then answers with file + line citations (exact extraction or cited synthesis from the chunks).
4. If nothing in the pack supports the claim, the card stays empty. There is no general-knowledge fallback.

## Run

```bash
npm i
cp .env.example .env
npm run dev
```

## On a call

- Load your service folder (src/, not the repo root)
- Search with `S` or `Ctrl/Cmd+K`
- Listen live with `L` (laptop mic, Chrome/Edge)
- Overlay mode with `O` for second monitor

## Stack

TanStack Start · React 19 · Tailwind v4 · zustand · Dexie (local-only)
