# MeetHint

Browser meeting copilot. Load a folder. When a question lands, Search. The card is the line you say — taken from a file you brought, with that file under it. If the pack cannot cite it, the card stays empty.

Nothing is generated. Search does not call a model.

The GitHub repo is HintAI. The product is MeetHint.

## Run

```bash
npm i
cp .env.example .env
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

API keys are unused on the answer path. Search extracts a cited line in the browser, or stays silent.

## On a call

1. Open the **src** folder (or one service), not a 60k-file repo root.
2. Paste the question in Room.
3. Hit **Search**.
4. Read the card.

Listen live uses this laptop’s microphone (Chrome/Edge). It cannot hear Zoom internally, and it will not run inside an embedded preview iframe — use a normal Chrome tab.

Hotkeys: `S` or `Ctrl/Cmd+K` search · `L` listen · `O` overlay.

## Layout

- **Cockpit** — repo · room · card
- **Overlay** — room + card for a second monitor

## Stack

TanStack Start · React 19 · Tailwind v4 · zustand
