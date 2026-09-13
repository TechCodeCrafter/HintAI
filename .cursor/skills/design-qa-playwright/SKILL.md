---
name: design-qa-playwright
description: >-
  Design QA loop for MeetHint using Playwright (rendered surfaces) plus Impeccable
  detect (deterministic anti-slop rules), ui-ux-pro-max (searchable UX data), and
  emil-design-eng / review-animations (motion taste only when requested). Use when
  polishing landing or cockpit UI, auditing visual quality before ship, or running
  the design CI loop.
---

# Design QA + Playwright

MeetHint has **behavioral** e2e (cite-or-silence, cockpit, billing). This skill adds **visual/design** verification without replacing product contract tests.

**Authority order (never invert):**

1. `src/lib/search/__tests__/cite-or-silence.test.ts` — product pipeline and copy contract
2. `src/lib/__tests__/brand-contract.test.ts` — brand module + skill isolation
3. Playwright design surfaces (screenshots + axe)
4. Impeccable detect (warning-only in CI)

Design skills **must not** edit `src/lib/brand.ts` or paraphrase cite-or-silence product copy.

## Surfaces

| Route | Mode | Skills allowed |
|-------|------|----------------|
| `/` landing | **Persuade** | impeccable polish/critique, ui-ux-pro-max, emil motion **only when asked** |
| `/app` cockpit | **Operate** | impeccable + ui-ux-pro-max + a11y only — **no** redesign, **no** GSAP/scroll motion without explicit ask |

## Loop for any UI change

1. Run design surfaces e2e (included in `npm run test:e2e`):

   ```bash
   npm run test:e2e -- e2e/design-surfaces.spec.ts
   ```

2. Run Impeccable detect on the **same preview server** Playwright uses (`127.0.0.1:4173`):

   ```bash
   npm run design:detect
   ```

   Findings JSON: `.impeccable/last-run.json` (gitignored). Review count in CI output.

3. **Attach before/after screenshots** to the PR (Playwright snapshots under `e2e/__screenshots__/` or manual captures).

4. On touched UI files, optional source scan:

   ```bash
   .cursor/skills/impeccable/scripts/impeccable detect src/components/<file>.tsx
   ```

## Product and design docs

- `PRODUCT.md` — durable product truth (cite-or-silence, users, constraints). Impeccable `/impeccable init`.
- `DESIGN.md` — visual language extracted from code (dark cockpit, IBM Plex, violet accent). Impeccable `/impeccable document`.

Do **not** install taste-skill or run open-ended redesign passes on the cockpit.

## CI

- **Required:** unit tests + full e2e (includes `design-surfaces.spec.ts`).
- **Warning-only:** `DESIGN_DETECT_WARN_ONLY=1 npm run design:detect` — reports findings, exits 0.

Tune intentional brand waivers only in `.impeccable/config.json` (`_ignoreNotes` documents why). Prefer fixing UI over growing the ignore list.

## Installed skills

| Skill | Use |
|-------|-----|
| **ui-ux-pro-max** | Searchable UX/a11y/stack guidance |
| **impeccable** | Detect + `/impeccable audit` / `polish` |
| **emil-design-eng**, **review-animations** | Motion taste — landing only, when requested |

Pick **one** generative skill per task plus verifiers above.
