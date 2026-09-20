# Social sharing preview

Last updated: 2026-09-20

## Asset

| Field | Value |
|-------|--------|
| File | `public/og/meethint-og-v2.png` |
| Size | 1200 × 630 |
| Public URL | `https://www.meethint.ai/og/meethint-og-v2.png` |
| Regenerate | `npm run generate:og` |

Design: dark navy canvas, blue/violet gradient glow, MeetHint mark + wordmark, headline **Know before you answer.**, and a product-style answer card (SSO / SCIM example with GitHub · Docs · PDF sources).

Legacy `/og.jpg` is removed from the repo; Vercel redirects `/og.jpg` → `/og/meethint-og-v2.png` so stale crawler cache on the old path still resolves.

## Metadata (SSR via `src/routes/__root.tsx`)

Single authoritative source: `src/lib/brand.ts` (copy + image URL) and `src/lib/og/share-meta.ts` (tag list).

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
| `og:image` | `https://www.meethint.ai/og/meethint-og-v2.png` |
| `og:image:width` / `height` | 1200 / 630 |
| `og:image:alt` | MeetHint — real-time answers for technical conversations |
| `twitter:card` | `summary_large_image` |
| `twitter:title` | MeetHint — Know before you answer |
| `twitter:description` | Real-time answers from your repos, docs, and company knowledge. |
| `twitter:image` | `https://www.meethint.ai/og/meethint-og-v2.png` |

The marketing route (`/`) stays `ssr: false` for autofill hydration; OG tags are on the root route so crawlers receive them in the initial HTML without client JS.

MeetHint hosts skip Grok PWA stream head injection (`shouldStreamInjectHead`) so SSR tags are not overwritten.

## Platform behavior

| Platform | Expected preview |
|----------|------------------|
| **Facebook / LinkedIn** | Large image card with headline + product mock; title/description from Open Graph |
| **X (Twitter)** | `summary_large_image` — full 1200×630 asset, headline readable with ~40px safe margins |
| **Slack / Discord / iMessage** | OG image + title + description unfurl |

## Meta Sharing Debugger

After deploy:

1. `npm run verify:social-meta` — curls production HTML as `facebookexternalhit` and checks every tag + PNG HEAD.
2. Open [Sharing Debugger](https://developers.facebook.com/tools/debug/) for `https://www.meethint.ai/` and click **Scrape Again**.

### Remaining warning (safe to ignore)

| Property | Status |
|----------|--------|
| `fb:app_id` | **Not set** — intentional. MeetHint does not currently use a Meta app integration. Meta may show a warning; previews still render. Add only when a real Meta App ID is configured. |

`og:url` and `og:type` are required and present in SSR output.

## Validation checklist

```bash
npm run generate:og    # refresh PNG if copy/layout changes
npm run typecheck
npm test
npm run build
npm run verify:social-meta   # after deploy
```

- [x] OG tags defined in SSR head (`__root__.tsx` → `shareOgHeadMeta()`)
- [x] Canonical URL with trailing slash
- [x] Versioned PNG at `public/og/meethint-og-v2.png`
- [x] No `public/og.jpg` in repo; redirect for legacy URL
- [x] No duplicate share meta from Grok PWA injector on meethint.ai
