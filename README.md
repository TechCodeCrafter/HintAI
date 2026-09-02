# MeetHint

Browser meeting copilot. Load a folder. Ask a question. The answer is a line from your files — exact, cited, or silent.

## How it works

1. Pick a folder (code, docs, contracts). Stays in your browser, never hits a server.
2. Ask a question in the Room.
3. MeetHint extracts a line that answers it, with file + range.
4. If no line supports the claim, the card stays empty.

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
