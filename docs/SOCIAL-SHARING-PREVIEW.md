# Social sharing preview

Last updated: 2026-09-20

## Asset

| Field | Value |
|-------|--------|
| File | `public/og/meethint-og-v3.png` |
| Size | 1200 × 630 |
| Public URL | `https://www.meethint.ai/og/meethint-og-v3.png` |
| Regenerate | `npm run generate:og` |
| Official mark | Composited from `public/favicon.svg` (same geometry as `MeetHintMark`) |

Legacy paths (`/og.jpg`, `meethint-og.png`, `meethint-og-v2.png`) redirect to v3 via `vercel.json`.

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
| `og:image` | `https://www.meethint.ai/og/meethint-og-v3.png` |
| `og:image:width` / `height` | 1200 / 630 |
| `og:image:alt` | MeetHint social preview showing the official logo and a cited technical answer card |
| `twitter:card` | `summary_large_image` |
| `twitter:title` | MeetHint — Know before you answer |
| `twitter:description` | Real-time answers from your repos, docs, and company knowledge. |
| `twitter:image` | `https://www.meethint.ai/og/meethint-og-v3.png` |

## Meta Sharing Debugger

After deploy:

1. `npm run verify:social-meta`
2. [Sharing Debugger](https://developers.facebook.com/tools/debug/) → **Scrape Again**

### Remaining warning (safe to ignore)

| Property | Status |
|----------|--------|
| `fb:app_id` | **Not set** — intentional. MeetHint does not currently use a Meta app integration. Meta may show a warning; previews still render. |
