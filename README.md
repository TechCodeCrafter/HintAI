# MeetHint

Browser meeting copilot. Load a folder. Ask a question.
The answer is a line from your files — exact, cited, or silent.

The GitHub repo is HintAI. The product is MeetHint.

## How it works

1. Pick a folder (code, docs, contracts). Stays in your browser.
2. Ask a question in the Room.
3. MeetHint extracts a line that answers it, with file + range.
4. If no line supports the claim, the card stays empty.

Nothing is generated. Search does not call a model.

## Stack

TanStack Start · React 19 · Tailwind v4 · zustand · Dexie (local)

## Run

```bash
npm i
cp .env.example .env
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

## On a call

- Load your service folder
- Search with `S` or `Ctrl/Cmd+K`
- Listen live with `L` (laptop mic, Chrome/Edge)
- Overlay mode with `O` for second monitor
