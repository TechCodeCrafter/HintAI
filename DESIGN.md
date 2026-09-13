---
name: MeetHint
description: Dark developer cockpit with IBM Plex typography and violet accent — cite-or-silence meeting copilot
colors:
  bg: "#0b0d12"
  nav: "#0d1016"
  surface: "#11141b"
  subtle: "#151923"
  fg: "#f4f6f8"
  body: "#a0a8b5"
  muted: "#697386"
  accent: "#7c6cf2"
  accent-hover: "#8a7cf5"
  accent-soft: "rgb(124 108 242 / 0.12)"
  line: "#222731"
  ok: "#49c98d"
  bad: "#f97066"
  warn: "#f5b85a"
typography:
  sans:
    fontFamily: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif'
    fontSize: "16px"
    lineHeight: 1.5
  mono:
    fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace'
    fontSize: "13px"
    lineHeight: 1.45
  display:
    fontFamily: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif'
    fontWeight: 600
    letterSpacing: "-0.02em"
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
spacing:
  panel: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.panel}"
---

# MeetHint design system

Extracted from `src/styles.css`, cockpit, and landing components. Tokens in frontmatter are normative.

## Overview

Dark-first **Operate** cockpit (meeting UI) plus a lighter **Persuade** marketing landing (`hint-landing`). Charcoal surfaces (`#0b0d12`–`#151923`), not pure black. Violet (`#7c6cf2`) is the **only** saturated brand accent; syntax and status colors stay cooler so code highlights do not compete with CTAs.

Light theme inverts to cool desk whites (`#f4f5f7` canvas, `#15181d` ink) with a slightly deeper violet accent (`#5e4ce6`).

## Colors

| Role | Dark | Light | Use |
|------|------|-------|-----|
| Canvas | `#0b0d12` | `#f4f5f7` | Page background |
| Surface | `#11141b` | `#ffffff` | Cards, panels |
| Body text | `#a0a8b5` | `#3d4550` | Paragraphs |
| Muted | `#697386` | `#5b6573` | Labels, chrome |
| Accent | `#7c6cf2` | `#5e4ce6` | Primary buttons, focus rings, cited markers |
| OK / cited | `#49c98d` | `#49c98d` | Grounded answers |
| Bad | `#f97066` | `#f97066` | Errors |

Do not introduce purple-to-blue marketing gradients or gray text on saturated accent backgrounds.

## Typography

- **UI / marketing:** IBM Plex Sans (400–700). Loaded from Google Fonts in `__root.tsx`.
- **Code / paths:** JetBrains Mono with IBM Plex Mono fallback.
- **Display:** Tight tracking (`-0.02em`), semibold; landing uses `hint-display` scale (~2.6rem hero).
- **Body:** 16px base, `leading-relaxed` (1.625) for readable paragraphs.

## Layout

- Cockpit: three-column density — repo, room/card, sources — with sticky nav chrome.
- Landing: `hint-wrap` max-width container, generous section padding (`py-16`–`py-24`).
- Mobile-first breakpoints via Tailwind (`sm`, `md`, `lg`).

## Elevation & Depth

- Panels use hairline borders (`--panel-edge`, `#222731`) rather than heavy shadow stacks.
- `--menu-shadow` for dropdowns only; cards avoid nested shadow-on-shadow.
- Glass reserved for nav chrome (`--glass-face`); content panels stay opaque.

## Shapes

- Radius scale: 4 / 8 / 10 / 12px (`--radius-xs` through `--radius-lg`).
- Buttons and inputs: 8–10px radius; no pill-everything default.

## Components

- **Primary button:** accent fill, white label, hover `#8a7cf5`, focus ring via `--color-accent-soft`.
- **Secondary:** border on `--panel-edge`, transparent fill.
- **Card (answer):** surface background, left accent bar when cited, empty state with reason text — never filler copy.
- **Landing chips:** `hint-chip` with optional `limits` / `soon` badges for honest format support.

## Do's and Don'ts

**Do**

- Keep violet as accent only; use green for “grounded/cited” state.
- Preserve cite-or-silence copy verbatim from `src/lib/brand.ts`.
- Test dark and light themes for contrast on body and muted text.

**Don't**

- Swap IBM Plex for Inter, system UI, or “AI default” pairings on product surfaces.
- Add scroll-jacking, GSAP hero motion, or decorative animation to the cockpit without explicit ask.
- Promise generated answers when files cannot cite.

## Responsive behavior

- Touch targets ≥44px on primary actions (listen, search, waitlist submit).
- Room transcript collapses long turns with Show more/less.
- Landing grid stacks to single column below `md`.

## Agent prompt guide

When extending UI: dark charcoal canvas, IBM Plex Sans, violet `#7c6cf2` accents, monospace for paths, cite-or-silence voice. Operate surfaces prioritize scanability; landing may use restrained motion only via emil-design-eng when requested.
