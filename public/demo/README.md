Landing posters stay in git. The mp4s do not (~25MB).

- Source: `assets/brag/ad.mp4` → `public/demo/meethint-demo-cutaway.mp4` via `copy-demo-media.mjs`
- Dev: run `node scripts/copy-demo-media.mjs` (or `git checkout 54057ff -- public/demo/*.mp4` as fallback)
- Build: `npm run build` runs `copy-demo-media.mjs` automatically
- Production: `demoMediaUrl()` serves first-party `/demo/*` on the deployed origin
- Override: set `VITE_DEMO_MEDIA_BASE` (no trailing slash) for a custom CDN base
