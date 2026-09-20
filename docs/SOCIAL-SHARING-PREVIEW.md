# Social sharing preview

Last updated: 2026-09-20

## Asset

| Field | Value |
|-------|--------|
| File | `public/og/meethint-og.png` |
| Size | 1200 × 630 |
| Public URL | `https://www.meethint.ai/og/meethint-og.png` |
| Regenerate | `npm run generate:og` |

Design: dark navy canvas, blue/violet gradient glow, MeetHint mark + wordmark, headline **Know before you answer.**, and a product-style answer card (SSO / SCIM example with GitHub · Docs · PDF sources).

## Metadata (SSR via `src/routes/__root.tsx`)

| Tag | Value |
|-----|--------|
| `<title>` | MeetHint — Real-time answers for technical conversations |
| `meta description` | MeetHint gives you real-time, cited answers during technical conversations using your repos, docs, and company knowledge. |
| `link rel=canonical` | `https://www.meethint.ai/` |
| `og:title` | MeetHint — Know before you answer |
| `og:description` | Real-time, evidence-backed answers for technical conversations. Grounded in your repos, docs, and company knowledge. |
| `og:type` | `website` |
| `og:url` | `https://www.meethint.ai/` |
| `og:site_name` | MeetHint |
| `og:image` | `https://www.meethint.ai/og/meethint-og.png` |
| `og:image:width` / `height` | 1200 / 630 |
| `og:image:alt` | MeetHint — real-time answers for technical conversations |
| `twitter:card` | `summary_large_image` |
| `twitter:title` | MeetHint — Know before you answer |
| `twitter:description` | Real-time answers from your repos, docs, and company knowledge. |
| `twitter:image` | `https://www.meethint.ai/og/meethint-og.png` |

Implementation: `src/lib/og/share-meta.ts` + `src/lib/brand.ts`.

The marketing route (`/`) stays `ssr: false` for autofill hydration; OG tags are on the root route so crawlers receive them without client JS.

## Platform behavior

| Platform | Expected preview |
|----------|------------------|
| **Facebook / LinkedIn** | Large image card with headline + product mock; title/description from Open Graph |
| **X (Twitter)** | `summary_large_image` — full 1200×630 asset, headline readable with ~40px safe margins |
| **Slack / Discord / iMessage** | OG image + title + description unfurl |

## Meta Sharing Debugger

After deploy, open [Sharing Debugger](https://developers.facebook.com/tools/debug/) for `https://www.meethint.ai/` and click **Fetch new information**.

### Remaining warning (safe to ignore)

| Property | Status |
|----------|--------|
| `fb:app_id` | **Not set** — intentional. No Facebook Login / Social Plugins integration exists. Meta shows a warning; previews still render. Add only when a real Meta App ID is configured. |

`og:url` and `og:type` are now present — the previous missing-property warnings for those should clear after rescrape.

## Validation checklist

```bash
npm run generate:og    # refresh PNG if copy/layout changes
npm run typecheck
npm test
npm run build
# Optional: grep built SSR output for og:image after deploy
```

- [x] OG tags defined in SSR head (`__root__.tsx`)
- [x] Canonical URL with trailing slash
- [x] No duplicate `og:image` pointing at legacy `og.jpg` in app head
- [x] PNG committed at `public/og/meethint-og.png`

Legacy plain **Hint** card (`public/og.jpg`) is superseded for TanStack head tags; file may remain for Grok PWA bake until removed separately.
