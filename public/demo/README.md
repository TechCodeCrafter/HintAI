Landing posters stay in git. The mp4s do not (~25MB).

- Dev: keep rendered files here (`npm run video:render` and friends), or copy from the last commit that had them: `git checkout ba30b35 -- public/demo`
- Production: `demoMediaUrl()` loads from the pinned jsDelivr copy of that commit, or from `VITE_DEMO_MEDIA_BASE`
