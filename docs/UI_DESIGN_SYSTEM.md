# MeetHint UI Design System

Enterprise-grade UI foundations for the public site and authenticated product. Purple is an **accent only** — surfaces stay neutral.

## Colors

Tokens live in `src/styles.css` (`@theme`) and `src/styles/design-system.css`.

| Token | Role |
|---|---|
| `--color-accent` | Primary actions, active nav, focus rings |
| `--color-bg` | Page background |
| `--color-surface` | Cards, panels |
| `--color-subtle` | Secondary surfaces, hover wash |
| `--color-line` | Borders |
| `--color-fg` / `--color-body` / `--color-muted` | Text hierarchy |
| `--color-ok` / `--color-warn` / `--color-bad` | Status semantics |

Light mode is the default for marketing; product respects `html[data-theme]`.

## Typography

Utility classes in `design-system.css`:

| Class | Use |
|---|---|
| `.ds-overline` | Section labels (uppercase, accent) |
| `.ds-display` | Page heroes |
| `.ds-page-title` | In-app page titles |
| `.ds-section-title` | Section headers |
| `.ds-card-title` | Card headings |
| `.ds-body` | Body copy |
| `.ds-caption` | Metadata, hints |

Font stack: IBM Plex Sans (UI), JetBrains Mono (code/citations).

## Spacing

- App content max-width: `72rem` (wide layouts: `90rem`)
- Card padding: `1–1.25rem`
- Section gaps: `2–2.5rem`
- Control min-height: `44px` (touch-friendly)

## Surfaces

| Class | Description |
|---|---|
| `.ds-surface` | Standard bordered card |
| `.ds-surface-elevated` | Card + shadow |
| `.ds-surface-subtle` | Muted inset panel |
| `.ds-card-interactive` | Selectable cards (create flow) |
| `.ds-dropzone` | Material upload targets |

## Buttons

`src/components/ui/button.tsx` — variants: `primary`, `secondary`, `outline`, `ghost`, `danger`. Sizes: `sm`, `md`, `lg`, `icon`.

Marketing CTAs use `.hint-btn` / `.mh-cta` for landing compatibility.

## Inputs

- `.mh-field` — single-line inputs
- `.ground-input` / `.ground-question` — cockpit ask surfaces
- `SearchInput`, `Textarea` in `src/components/ui/input.tsx`

## Status badges

`src/components/ui/badge.tsx` — `ready`, `indexing`, `error`, `listening`, `idle`, `local`, `unsupported`, `neutral`. Use `dot` prop for live indicators.

## Navigation

`AppShell` (`src/components/app-shell.tsx`):

- Desktop: fixed sidebar (Home, Knowledge Spaces, Live session)
- Mobile: top bar + collapsible nav
- No dead links — only routes that exist today

## Citation UI

- Answer receipt: `.answer-receipt`, `.answer-receipt-body`
- Citation chips: `.cite-chip`, `VerifiedCitations` component
- Unsupported: `card-reason` with intentional empty copy — never generic errors

## Unsupported answer UI

When material cannot support an answer:

- Show the question heard/typed
- Explain silence with product copy (e.g. material doesn't cover this)
- Do **not** show fabricated answers or generic “I don't know” chatbot tone

## Responsive behavior

- Marketing: tested 390px–1920px via Playwright snapshots
- App shell: sidebar from `1024px`; stacked mobile nav below
- Cockpit: existing three-pane collapse rules preserved (`cockpit-grid` breakpoints)

## Motion

- Transitions: `150–220ms`
- Listening: `.ds-listen-ring` pulse (respects `prefers-reduced-motion` via global rules)
- No decorative blob animation in product chrome

## Copy principles

1. **Cite it, or stay silent.**
2. Never claim integrations or compliance not implemented.
3. Prefer “Knowledge Space” in user-facing copy; `context` remains internal.
