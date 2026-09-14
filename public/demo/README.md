Landing posters stay in git. The mp4s do not (~25MB).

- Dev: run `node scripts/copy-demo-media.mjs` (or `git checkout ba30b35 -- public/demo/*.mp4`)
- Build: `npm run build` runs `copy-demo-media.mjs` automatically
- Production: `demoMediaUrl()` serves first-party `/demo/*` on the deployed origin
- Override: set `VITE_DEMO_MEDIA_BASE` (no trailing slash) for a custom CDN base
