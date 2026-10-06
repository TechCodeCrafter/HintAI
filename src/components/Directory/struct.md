Directory structure:
└── techcodecrafter-hintai/
    ├── README.md
    ├── ARCHITECTURE.md
    ├── CHANGELOG.md
    ├── DESIGN.md
    ├── eslint.config.mjs
    ├── LICENSE
    ├── package.json
    ├── playwright.config.ts
    ├── playwright.production-smoke.config.ts
    ├── PRODUCT.md
    ├── remotion.config.ts
    ├── ROADMAP.md
    ├── startup.sh
    ├── tsconfig.json
    ├── vercel.json
    ├── vite.config.ts
    ├── .env.example
    ├── .node_modules.lock
    ├── .npmrc
    ├── .prettierrc
    ├── config/
    │   └── mail-contacts.json
    ├── docs/
    │   ├── ARCHIVE.md
    │   ├── BETA-ISSUE-TRIAGE.md
    │   ├── beta-tester-brief.html
    │   ├── BETA-TESTER-INSTRUCTIONS.md
    │   ├── beta-testing-session.html
    │   ├── BETA-TESTING-SESSION.md
    │   ├── DOMAIN-REPUTATION.md
    │   ├── ENTERPRISE-ALLOWLIST.md
    │   ├── FRESH-ACCOUNT-PRODUCTION-SMOKE.md
    │   ├── NEXT.md
    │   ├── PERFORMANCE-TARGET.md
    │   ├── PRODUCT-BACKLOG.md
    │   ├── PRODUCTION-AUTH-VERIFICATION.md
    │   ├── RED-TEAM.md
    │   ├── SOCIAL-SHARING-PREVIEW.md
    │   ├── TENANT-ISOLATION.md
    │   ├── TRUTH-ASSESSMENT-LAYER.md
    │   ├── UI_DESIGN_SYSTEM.md
    │   ├── archive/
    │   │   ├── BETA-MILESTONE-REPORT.md
    │   │   ├── BETA-WAVE-1.md
    │   │   ├── GAP-ANALYSIS.md
    │   │   ├── PERFORMANCE-CAPTURE.md
    │   │   ├── PERFORMANCE-MILESTONE-2.md
    │   │   └── UI_REDESIGN_REPORT.md
    │   ├── dns/
    │   │   └── meethint.ai-records.md
    │   └── experiments/
    │       ├── JEV-EVALUATION.md
    │       └── JEV-TRUTH-JUDGE-REPORT.md
    ├── e2e/
    │   ├── account-isolation.spec.ts
    │   ├── audio-path.spec.ts
    │   ├── auth-config.spec.ts
    │   ├── auth-production.spec.ts
    │   ├── authenticated-persistence.spec.ts
    │   ├── citation-range.spec.ts
    │   ├── cite-or-silence.spec.ts
    │   ├── claim-audit.spec.ts
    │   ├── cockpit-chrome.spec.ts
    │   ├── context-lifecycle.spec.ts
    │   ├── delete-space.spec.ts
    │   ├── design-surfaces.spec.ts
    │   ├── domain-reputation.spec.ts
    │   ├── funnel-no-signin.spec.ts
    │   ├── grounded-mode.spec.ts
    │   ├── home-first-proof.spec.ts
    │   ├── knowledge-space.spec.ts
    │   ├── landing-signup.spec.ts
    │   ├── private-workspace.spec.ts
    │   ├── production-smoke-preauth.spec.ts
    │   ├── production-smoke.spec.ts
    │   ├── review-pack.spec.ts
    │   ├── signup-telemetry.spec.ts
    │   ├── subscription-tier.spec.ts
    │   ├── ui-redesign-screenshots.spec.ts
    │   └── fixtures/
    │       ├── README.md
    │       ├── audio-path.ts
    │       ├── auth.ts
    │       ├── funnel.ts
    │       ├── helpers.ts
    │       ├── mocks.ts
    │       ├── persistence.ts
    │       ├── production-smoke-auth.ts
    │       ├── production-smoke-keys.ts
    │       ├── production-smoke-profile.ts
    │       ├── production-smoke-shared.ts
    │       ├── production-smoke-storage.ts
    │       ├── telemetry.ts
    │       └── wav-pcm.ts
    ├── fixtures/
    │   └── evals/
    │       └── truth-judge/
    │           ├── README.md
    │           ├── escalation.json
    │           ├── evidence-applicability.json
    │           ├── manifest.json
    │           └── question-classification.json
    ├── migrations/
    │   ├── 0001_auth.sql
    │   ├── 0002_waitlist.sql
    │   ├── 0003_server_corpus.sql
    │   └── auth/
    │       └── 0001_auth.sql
    ├── public/
    │   ├── ground-capture-worklet.js
    │   ├── meethint-asr-worker.js
    │   ├── meethint-pcm-worklet.js
    │   ├── theme-boot.js
    │   ├── __grok/
    │   │   └── install/
    │   │       └── styles.css
    │   ├── demo/
    │   │   └── README.md
    │   └── .well-known/
    │       └── security.txt
    ├── scripts/
    │   ├── app-env-plugin.mjs
    │   ├── beta-gates.mjs
    │   ├── beta-quality-report.mjs
    │   ├── bisect-hydration.mjs
    │   ├── brand-check.mjs
    │   ├── brand-check.test.mjs
    │   ├── browser-guard.mjs
    │   ├── browser-smoke-verdict.mjs
    │   ├── browser-smoke-verdict.test.mjs
    │   ├── browser-smoke.mjs
    │   ├── build-truth-judge-fixtures.mjs
    │   ├── capture-flight-session.mjs
    │   ├── capture-smoke-auth.mjs
    │   ├── check-auth-invariant.mjs
    │   ├── check-auth-invariant.test.mjs
    │   ├── check-branch-fresh.mjs
    │   ├── check-branch-fresh.test.mjs
    │   ├── check-cursor-attribution.mjs
    │   ├── check-cursor-attribution.test.mjs
    │   ├── check-production-auth-build.mjs
    │   ├── check-production-auth-build.test.mjs
    │   ├── context-persist-qa.mjs
    │   ├── copy-demo-media.mjs
    │   ├── copy-pglite-assets.mjs
    │   ├── cursor-attribution.mjs
    │   ├── db-url.mjs
    │   ├── design-detect.mjs
    │   ├── domain-reputation.test.mjs
    │   ├── e2e-preview-shared.mjs
    │   ├── enable-githooks.mjs
    │   ├── eval-truth-judge.mjs
    │   ├── fix-ssr-bundle.mjs
    │   ├── flight-analyze.mjs
    │   ├── flight-grounded-5d.mjs
    │   ├── flight-summary.mjs
    │   ├── flight-validate-5d.mjs
    │   ├── generate-meethint-og.mjs
    │   ├── generate-og-card.mjs
    │   ├── grok-pwa-plugin.mjs
    │   ├── grok-pwa-plugin.test.mjs
    │   ├── grok-pwa-shared.d.mts
    │   ├── grok-pwa-shared.mjs
    │   ├── ground-qa.mjs
    │   ├── install-page.html
    │   ├── latency-benchmark.mjs
    │   ├── make-score.mjs
    │   ├── make-voice.mjs
    │   ├── migrate.mjs
    │   ├── migration-plan.mjs
    │   ├── migration-plan.test.mjs
    │   ├── preview-thumbnail.mjs
    │   ├── preview.mjs
    │   ├── preview.test.mjs
    │   ├── production-smoke-sanitize.mjs
    │   ├── production-smoke-sanitize.test.mjs
    │   ├── production-smoke-setup.mjs
    │   ├── publish-mail-contacts.mjs
    │   ├── rdb-dryrun.ts
    │   ├── redteam-harness.mjs
    │   ├── resolve-app-version.mjs
    │   ├── resolve-app-version.test.mjs
    │   ├── retrieve-baseline.ts
    │   ├── run-production-smoke.mjs
    │   ├── run-tests.mjs
    │   ├── security-headers-plugin.mjs
    │   ├── security-headers.mjs
    │   ├── sign-out-plan.mjs
    │   ├── sign-out-plan.test.mjs
    │   ├── smoke-session.mjs
    │   ├── strip-cursor-trailer.mjs
    │   ├── strip-cursor-trailer.test.mjs
    │   ├── sync-github-repo.mjs
    │   ├── verify-beta-diagnostics.mjs
    │   ├── verify-domain-email.mjs
    │   ├── verify-production-auth.mjs
    │   ├── verify-production-auth.test.mjs
    │   ├── verify-production-deploy.mjs
    │   ├── verify-production-deploy.test.mjs
    │   ├── verify-production-social-meta.mjs
    │   ├── verify-smoke-auth.mjs
    │   ├── with-app-env.mjs
    │   ├── with-app-env.test.mjs
    │   ├── write-atomic.mjs
    │   └── write-atomic.test.mjs
    ├── security/
    │   ├── deepteam/
    │   │   ├── README.md
    │   │   ├── pyproject.toml
    │   │   └── redteam_hintai.py
    │   └── reports/
    │       └── .gitkeep
    ├── server/
    │   ├── virtual-grok-og-identity.d.ts
    │   └── middleware/
    │       ├── 0-security-headers.ts
    │       └── grok-pwa.ts
    ├── src/
    │   ├── fonts.css
    │   ├── router.tsx
    │   ├── routeTree.gen.ts
    │   ├── styles.css
    │   ├── components/
    │   │   ├── anonymous-tier-banner.tsx
    │   │   ├── answer-feedback.tsx
    │   │   ├── answer-history.tsx
    │   │   ├── answer-mode-control.tsx
    │   │   ├── answer-say.tsx
    │   │   ├── api-key-settings.tsx
    │   │   ├── app-shell.tsx
    │   │   ├── ask-panel.tsx
    │   │   ├── auth-chrome.tsx
    │   │   ├── beta-onboarding.tsx
    │   │   ├── beta-privacy-notice.tsx
    │   │   ├── beta-telemetry-boot.tsx
    │   │   ├── claim-monitor.tsx
    │   │   ├── context-detail.tsx
    │   │   ├── context-home.tsx
    │   │   ├── context-shell.tsx
    │   │   ├── create-context-flow.tsx
    │   │   ├── home-proof.tsx
    │   │   ├── live-nav-link.tsx
    │   │   ├── login-page.tsx
    │   │   ├── material-upload-panel.tsx
    │   │   ├── meethint-landing-enterprise.tsx
    │   │   ├── meethint-landing.tsx
    │   │   ├── meethint-mark.tsx
    │   │   ├── ModelPicker.tsx
    │   │   ├── pdf-pane.tsx
    │   │   ├── preview-host-bridge.tsx
    │   │   ├── product-state-alert.tsx
    │   │   ├── require-auth.tsx
    │   │   ├── review-pack-dialog.tsx
    │   │   ├── session-receipt-panel.tsx
    │   │   ├── sources-exclusion-alert.tsx
    │   │   ├── theme-toggle.tsx
    │   │   ├── trust-mail-contacts.tsx
    │   │   ├── trust-page.tsx
    │   │   ├── UpgradeModal.tsx
    │   │   ├── use-folder-picker.ts
    │   │   ├── verified-citations.tsx
    │   │   └── ui/
    │   │       ├── badge.tsx
    │   │       ├── button.tsx
    │   │       ├── card.tsx
    │   │       ├── dropzone-card.tsx
    │   │       ├── empty-state.tsx
    │   │       ├── input.tsx
    │   │       ├── metric-card.tsx
    │   │       └── page-header.tsx
    │   ├── lib/
    │   │   ├── brand.ts
    │   │   ├── cn.ts
    │   │   ├── db.ts
    │   │   ├── debug.ts
    │   │   ├── demo-media.ts
    │   │   ├── e2e-hooks.ts
    │   │   ├── error-component.tsx
    │   │   ├── highlight.tsx
    │   │   ├── mail-contacts.ts
    │   │   ├── material-upload.ts
    │   │   ├── preview-embedder-origin.ts
    │   │   ├── preview-host-bridge.ts
    │   │   ├── product-states.ts
    │   │   ├── silence-onnx-warnings.ts
    │   │   ├── theme.test.ts
    │   │   ├── theme.ts
    │   │   ├── use-client-mounted.ts
    │   │   ├── waitlist.ts
    │   │   ├── __tests__/
    │   │   │   ├── brand-contract.test.ts
    │   │   │   ├── debug.test.ts
    │   │   │   ├── demo-media.test.ts
    │   │   │   ├── material-upload.test.ts
    │   │   │   └── product-states.test.ts
    │   │   ├── ai/
    │   │   │   ├── cardsmith.ts
    │   │   │   ├── client-keys.ts
    │   │   │   ├── fn-input.ts
    │   │   │   ├── models.ts
    │   │   │   ├── synthesis-client.ts
    │   │   │   ├── synthesis-guard.server.ts
    │   │   │   ├── synthesis-rate-limit.server.ts
    │   │   │   ├── transcribe.ts
    │   │   │   └── __tests__/
    │   │   │       ├── client-keys.test.ts
    │   │   │       ├── fn-input.test.ts
    │   │   │       ├── models.test.ts
    │   │   │       └── synthesis-guard.server.test.ts
    │   │   ├── app-data/
    │   │   │   ├── app-data.test.ts
    │   │   │   ├── client.server.ts
    │   │   │   ├── errors.ts
    │   │   │   ├── index.ts
    │   │   │   ├── login.ts
    │   │   │   ├── server-only.ts
    │   │   │   └── types.ts
    │   │   ├── audit/
    │   │   │   ├── admit.ts
    │   │   │   ├── claim-gate.ts
    │   │   │   ├── contradict.ts
    │   │   │   ├── index.ts
    │   │   │   ├── report.ts
    │   │   │   ├── repository.ts
    │   │   │   ├── session.ts
    │   │   │   ├── types.ts
    │   │   │   └── __tests__/
    │   │   │       ├── admit.test.ts
    │   │   │       ├── claim-gate.test.ts
    │   │   │       ├── contradict.test.ts
    │   │   │       ├── report.test.ts
    │   │   │       └── storage.test.ts
    │   │   ├── auth/
    │   │   │   ├── account-boundary.ts
    │   │   │   ├── account-session.ts
    │   │   │   ├── anonymous-tier.ts
    │   │   │   ├── client.ts
    │   │   │   ├── email-password.ts
    │   │   │   ├── gate-identity.server.ts
    │   │   │   ├── gate-identity.test.ts
    │   │   │   ├── gate-session.server.ts
    │   │   │   ├── gates.tsx
    │   │   │   ├── isolation.server.ts
    │   │   │   ├── middleware.ts
    │   │   │   ├── pglite-dialect.ts
    │   │   │   ├── popup.server.ts
    │   │   │   ├── preview.ts
    │   │   │   ├── production-config.server.ts
    │   │   │   ├── provider.tsx
    │   │   │   ├── providers.ts
    │   │   │   ├── server.ts
    │   │   │   ├── use-current-user.ts
    │   │   │   ├── verify.server.ts
    │   │   │   ├── workspace-identity.ts
    │   │   │   ├── workspace.ts
    │   │   │   └── __tests__/
    │   │   │       ├── account-boundary.test.ts
    │   │   │       ├── anonymous-tier.test.ts
    │   │   │       ├── production-config.server.test.ts
    │   │   │       └── tenant-isolation.test.ts
    │   │   ├── billing/
    │   │   │   ├── extract-quota.ts
    │   │   │   ├── subscription.ts
    │   │   │   ├── waitlist-email.ts
    │   │   │   ├── waitlist-local.ts
    │   │   │   └── __tests__/
    │   │   │       ├── extract-quota.test.ts
    │   │   │       ├── subscription.test.ts
    │   │   │       └── waitlist-local.test.ts
    │   │   ├── context/
    │   │   │   ├── chunk-index.ts
    │   │   │   ├── exclusions.ts
    │   │   │   ├── hash.ts
    │   │   │   ├── hydrate.ts
    │   │   │   ├── index-types.ts
    │   │   │   ├── index-versions.ts
    │   │   │   ├── kinds.ts
    │   │   │   ├── live-route.ts
    │   │   │   ├── material-view.ts
    │   │   │   ├── memory.ts
    │   │   │   ├── migration.ts
    │   │   │   ├── repo-bundle.ts
    │   │   │   ├── repository.ts
    │   │   │   ├── service.ts
    │   │   │   ├── source-identity.ts
    │   │   │   ├── source-write.ts
    │   │   │   ├── space-index.ts
    │   │   │   ├── space-types.ts
    │   │   │   ├── types.ts
    │   │   │   ├── __tests__/
    │   │   │   │   ├── document-chunks.test.ts
    │   │   │   │   ├── documents.test.ts
    │   │   │   │   ├── exclusions.test.ts
    │   │   │   │   ├── hydration.test.ts
    │   │   │   │   ├── indexing.test.ts
    │   │   │   │   ├── isolation.test.ts
    │   │   │   │   ├── migration.test.ts
    │   │   │   │   ├── multi-source-ingest.test.ts
    │   │   │   │   ├── repository-parity.test.ts
    │   │   │   │   ├── repository.test.ts
    │   │   │   │   ├── space-retrieval.test.ts
    │   │   │   │   ├── space-ui.test.ts
    │   │   │   │   └── summaries.test.ts
    │   │   │   └── storage/
    │   │   │       ├── indexeddb.ts
    │   │   │       ├── schema.ts
    │   │   │       └── vector-store-indexeddb.ts
    │   │   ├── deploy/
    │   │   │   ├── build-info.server.test.ts
    │   │   │   └── build-info.server.ts
    │   │   ├── document/
    │   │   │   ├── blocks.ts
    │   │   │   ├── chunk.ts
    │   │   │   ├── evidence.ts
    │   │   │   ├── source-text.ts
    │   │   │   ├── structure-diagnostics.ts
    │   │   │   ├── structure.ts
    │   │   │   ├── support-text.ts
    │   │   │   ├── types.ts
    │   │   │   ├── usable.ts
    │   │   │   ├── __tests__/
    │   │   │   │   ├── blocks-4a93.test.ts
    │   │   │   │   ├── chunk-4a94.test.ts
    │   │   │   │   ├── chunk.test.ts
    │   │   │   │   ├── evidence.test.ts
    │   │   │   │   └── structure.test.ts
    │   │   │   ├── parsers/
    │   │   │   │   ├── office-parsers.ts
    │   │   │   │   └── __tests__/
    │   │   │   │       └── office-parsers.test.ts
    │   │   │   ├── pdf/
    │   │   │   │   ├── accept.ts
    │   │   │   │   ├── add-files.ts
    │   │   │   │   ├── build-fixture.ts
    │   │   │   │   ├── eval-fixtures.ts
    │   │   │   │   ├── headers.ts
    │   │   │   │   ├── ingest-flow.ts
    │   │   │   │   ├── ingest.ts
    │   │   │   │   ├── items.ts
    │   │   │   │   ├── layout-geometry.ts
    │   │   │   │   ├── layout.ts
    │   │   │   │   ├── limits.ts
    │   │   │   │   ├── map.ts
    │   │   │   │   ├── normalize.ts
    │   │   │   │   ├── notes.ts
    │   │   │   │   ├── outline.ts
    │   │   │   │   ├── parse.ts
    │   │   │   │   ├── pdfjs.ts
    │   │   │   │   ├── prose-regions.ts
    │   │   │   │   ├── queue.ts
    │   │   │   │   ├── source-status.ts
    │   │   │   │   ├── usage.ts
    │   │   │   │   ├── worker.browser.ts
    │   │   │   │   └── __tests__/
    │   │   │   │       ├── add-files.test.ts
    │   │   │   │       ├── layout-4a92.test.ts
    │   │   │   │       ├── normalize.test.ts
    │   │   │   │       ├── parse.test.ts
    │   │   │   │       ├── snapshot.test.ts
    │   │   │   │       ├── store-ingest.test.ts
    │   │   │   │       └── twocol.test.ts
    │   │   │   └── viewer/
    │   │   │       ├── currentness.ts
    │   │   │       ├── highlight.ts
    │   │   │       ├── map.ts
    │   │   │       ├── metrics.ts
    │   │   │       ├── qa-boot.ts
    │   │   │       ├── render.ts
    │   │   │       ├── resolve.ts
    │   │   │       ├── retain.ts
    │   │   │       ├── session.ts
    │   │   │       ├── types.ts
    │   │   │       └── __tests__/
    │   │   │           └── viewer.test.ts
    │   │   ├── instrumentation/
    │   │   │   ├── answer-latency.ts
    │   │   │   ├── authenticated-signup-gate.ts
    │   │   │   ├── beta-diagnostics.ts
    │   │   │   ├── beta-quality-report.ts
    │   │   │   ├── beta-telemetry.ts
    │   │   │   ├── fast-path-quality.ts
    │   │   │   ├── flight-analysis.ts
    │   │   │   ├── flight-capture-harness.ts
    │   │   │   ├── flight-compare.ts
    │   │   │   ├── flight-recorder.ts
    │   │   │   ├── flight-session-synth.ts
    │   │   │   ├── flight-summary.ts
    │   │   │   ├── latency-benchmark.ts
    │   │   │   ├── progressive-agreement.ts
    │   │   │   ├── progressive-timing.ts
    │   │   │   └── __tests__/
    │   │   │       ├── answer-latency.test.ts
    │   │   │       ├── authenticated-signup-gate.test.ts
    │   │   │       ├── beta-telemetry.test.ts
    │   │   │       ├── fast-path-quality.test.ts
    │   │   │       ├── flight-analysis.test.ts
    │   │   │       ├── flight-recorder.test.ts
    │   │   │       ├── flight-summary.test.ts
    │   │   │       └── progressive-agreement.test.ts
    │   │   ├── listen/
    │   │   │   ├── browser-capability.ts
    │   │   │   ├── call-share.ts
    │   │   │   ├── capture-probe.ts
    │   │   │   ├── dictate.ts
    │   │   │   ├── local-asr.ts
    │   │   │   ├── onset-probe.ts
    │   │   │   ├── ring.test.ts
    │   │   │   ├── ring.ts
    │   │   │   ├── silero.ts
    │   │   │   ├── speech.ts
    │   │   │   ├── transcript-events.test.ts
    │   │   │   ├── transcript-events.ts
    │   │   │   ├── utterance-admission.ts
    │   │   │   ├── vad.test.ts
    │   │   │   ├── vad.ts
    │   │   │   ├── wav.ts
    │   │   │   └── __tests__/
    │   │   │       ├── browser-capability.test.ts
    │   │   │       └── utterance-admission.test.ts
    │   │   ├── meeting/
    │   │   │   └── script.ts
    │   │   ├── multiplayer/
    │   │   │   ├── index.ts
    │   │   │   └── p2p.ts
    │   │   ├── og/
    │   │   │   ├── share-meta.ts
    │   │   │   ├── site.json
    │   │   │   └── __tests__/
    │   │   │       └── share-meta.test.ts
    │   │   ├── repo/
    │   │   │   ├── folder.ts
    │   │   │   ├── northstar.ts
    │   │   │   ├── parser.ts
    │   │   │   ├── pick-folder.ts
    │   │   │   ├── structured-chunks.ts
    │   │   │   ├── types.ts
    │   │   │   ├── __tests__/
    │   │   │   │   └── folder-preview.test.ts
    │   │   │   └── parsers/
    │   │   │       ├── regex-parser.ts
    │   │   │       └── __tests__/
    │   │   │           └── regex-parser.test.ts
    │   │   ├── search/
    │   │   │   ├── answer-fast-path.ts
    │   │   │   ├── answer-history.ts
    │   │   │   ├── answer-mode.ts
    │   │   │   ├── answer-route.ts
    │   │   │   ├── architecture.ts
    │   │   │   ├── assist.ts
    │   │   │   ├── card.test.ts
    │   │   │   ├── cite.ts
    │   │   │   ├── claim-trace.ts
    │   │   │   ├── claim-verify.ts
    │   │   │   ├── document-card.ts
    │   │   │   ├── document-identity.ts
    │   │   │   ├── document-subject.ts
    │   │   │   ├── embed-chunks.ts
    │   │   │   ├── embedding.ts
    │   │   │   ├── evidence-span.ts
    │   │   │   ├── evidence.test.ts
    │   │   │   ├── evidence.ts
    │   │   │   ├── gate-log.ts
    │   │   │   ├── gate-newest.test.ts
    │   │   │   ├── gate.test.ts
    │   │   │   ├── generate-answer.ts
    │   │   │   ├── hybrid.ts
    │   │   │   ├── intent.test.ts
    │   │   │   ├── intent.ts
    │   │   │   ├── live-card-context.ts
    │   │   │   ├── local-card.ts
    │   │   │   ├── multi-source-compose.ts
    │   │   │   ├── polish.ts
    │   │   │   ├── prompt-profile.ts
    │   │   │   ├── prose.test.ts
    │   │   │   ├── prose.ts
    │   │   │   ├── question-contract.ts
    │   │   │   ├── question.ts
    │   │   │   ├── refine-payload.ts
    │   │   │   ├── retrieval-scope.ts
    │   │   │   ├── retrieval-trace.ts
    │   │   │   ├── retrieval-weights.ts
    │   │   │   ├── retrieve-trace.ts
    │   │   │   ├── retrieve.test.ts
    │   │   │   ├── retrieve.ts
    │   │   │   ├── say.ts
    │   │   │   ├── search-scope.ts
    │   │   │   ├── semantic-retrieve.ts
    │   │   │   ├── session-receipt.ts
    │   │   │   ├── spoken.test.ts
    │   │   │   ├── spoken.ts
    │   │   │   ├── subject.test.ts
    │   │   │   ├── subject.ts
    │   │   │   ├── text-map.test.ts
    │   │   │   ├── text-map.ts
    │   │   │   ├── thread.test.ts
    │   │   │   ├── thread.ts
    │   │   │   ├── vector-access.ts
    │   │   │   ├── vector-store.ts
    │   │   │   └── __tests__/
    │   │   │       ├── answer-fast-path.test.ts
    │   │   │       ├── answer-history.test.ts
    │   │   │       ├── answer-mode.test.ts
    │   │   │       ├── auto-route.test.ts
    │   │   │       ├── cite-or-silence.test.ts
    │   │   │       ├── claim-verify.test.ts
    │   │   │       ├── document-card.test.ts
    │   │   │       ├── document-safety.test.ts
    │   │   │       ├── embedding.test.ts
    │   │   │       ├── evidence-span.test.ts
    │   │   │       ├── field-fixes.test.ts
    │   │   │       ├── generate-answer.test.ts
    │   │   │       ├── hybrid-retrieve.test.ts
    │   │   │       ├── multi-source-answer.test.ts
    │   │   │       ├── prompt-profile.test.ts
    │   │   │       ├── question-contract.test.ts
    │   │   │       ├── retrieval-contract.test.ts
    │   │   │       ├── session-receipt.test.ts
    │   │   │       ├── structured-chunks.test.ts
    │   │   │       ├── vector-store.test.ts
    │   │   │       └── fixtures/
    │   │   │           └── uploads-router.py
    │   │   ├── security/
    │   │   │   ├── redteam-fixtures.ts
    │   │   │   ├── redteam-harness.ts
    │   │   │   └── __tests__/
    │   │   │       └── redteam-harness.test.ts
    │   │   ├── server-corpus/
    │   │   │   ├── api.ts
    │   │   │   ├── contract.ts
    │   │   │   ├── store.server.ts
    │   │   │   └── __tests__/
    │   │   │       └── contract.test.ts
    │   │   ├── store/
    │   │   │   └── session-wire.ts
    │   │   └── truth/
    │   │       ├── deterministic-judge.ts
    │   │       ├── index.ts
    │   │       ├── jev-client.ts
    │   │       ├── jev-judge.ts
    │   │       ├── llm-judge.ts
    │   │       ├── metrics.ts
    │   │       ├── question-classes.ts
    │   │       ├── truth-judge.ts
    │   │       └── __tests__/
    │   │           ├── deterministic-judge.test.ts
    │   │           └── metrics.test.ts
    │   ├── remotion/
    │   │   ├── cutaway-shots.tsx
    │   │   ├── Demo.tsx
    │   │   ├── index.ts
    │   │   ├── Root.tsx
    │   │   ├── shots.tsx
    │   │   ├── Social.tsx
    │   │   ├── theme.ts
    │   │   ├── vo-manifest.json
    │   │   ├── vo-script.json
    │   │   └── vo-social-manifest.json
    │   ├── routes/
    │   │   ├── __root.tsx
    │   │   ├── app.tsx
    │   │   ├── contact.tsx
    │   │   ├── context.$id.ask.tsx
    │   │   ├── context.$id.index.tsx
    │   │   ├── context.$id.live.tsx
    │   │   ├── context.$id.tsx
    │   │   ├── create.tsx
    │   │   ├── eval.viewer.tsx
    │   │   ├── home.tsx
    │   │   ├── index.tsx
    │   │   ├── login.tsx
    │   │   ├── privacy.tsx
    │   │   ├── relay.tsx
    │   │   ├── security.tsx
    │   │   ├── soon.tsx
    │   │   ├── terms.tsx
    │   │   └── api/
    │   │       ├── auth/
    │   │       │   ├── $.ts
    │   │       │   └── status.ts
    │   │       └── deploy/
    │   │           └── status.ts
    │   └── styles/
    │       ├── design-system.css
    │       ├── hint-landing-a11y.css
    │       ├── landing-enterprise-extras.css
    │       └── landing-enterprise-v2.css
    ├── .archive/
    │   └── AGENTS.md
    ├── .eval/
    │   └── README.md
    ├── .githooks/
    │   ├── commit-msg
    │   └── prepare-commit-msg
    ├── .github/
    │   └── workflows/
    │       ├── redteam-nightly.yml
    │       └── test.yml
    ├── .grok/
    │   ├── app-env.json
    │   ├── favicon-preview.html
    │   ├── references/
    │   │   ├── browser-qa.md
    │   │   ├── data-and-auth.md
    │   │   ├── deploy-target.md
    │   │   ├── generated-art.md
    │   │   ├── hibernate-revive.md
    │   │   └── scaffold.md
    │   └── skills/
    │       ├── auth/
    │       │   ├── SKILL.md
    │       │   └── references/
    │       │       ├── grok-identity.md
    │       │       ├── per-user-data.md
    │       │       ├── prewired-and-env.md
    │       │       ├── session-ui.md
    │       │       ├── sign-in-methods.md
    │       │       └── wiring.md
    │       ├── building-games/
    │       │   ├── SKILL.md
    │       │   └── references/
    │       │       ├── 3d-libs.md
    │       │       ├── ai-pathfinding.md
    │       │       ├── audio.md
    │       │       ├── babylon.md
    │       │       ├── collision-physics.md
    │       │       ├── ecs-architecture.md
    │       │       ├── game-feel-juice.md
    │       │       ├── input.md
    │       │       ├── phaser.md
    │       │       ├── procedural-generation.md
    │       │       ├── save-persistence.md
    │       │       ├── threejs-foundational.md
    │       │       └── genres/
    │       │           ├── board-card-chess.md
    │       │           ├── endless-runner.md
    │       │           ├── fps.md
    │       │           ├── platformer-2d.md
    │       │           ├── puzzle-match3-tetris.md
    │       │           ├── racing-kart.md
    │       │           ├── topdown-twin-stick.md
    │       │           ├── tower-defense.md
    │       │           └── voxel-minecraft.md
    │       ├── controls/
    │       │   └── SKILL.md
    │       ├── design-ui/
    │       │   ├── SKILL.md
    │       │   └── references/
    │       │       ├── animations.md
    │       │       ├── performance.md
    │       │       ├── refined-ui.md
    │       │       ├── surfaces.md
    │       │       └── typography.md
    │       ├── game-animation-frames/
    │       │   └── SKILL.md
    │       ├── game-asset-core/
    │       │   └── SKILL.md
    │       ├── game-character-consistency/
    │       │   └── SKILL.md
    │       ├── game-tilesets/
    │       │   └── SKILL.md
    │       ├── game-ui-icons/
    │       │   └── SKILL.md
    │       ├── generate2dmap/
    │       │   ├── LICENSE
    │       │   ├── SKILL.md
    │       │   ├── SOURCE.md
    │       │   ├── references/
    │       │   │   ├── deliverables.md
    │       │   │   ├── layered-map-contract.md
    │       │   │   ├── map-strategies.md
    │       │   │   ├── object-production-gate.md
    │       │   │   ├── pipeline.md
    │       │   │   ├── prop-pack-contract.md
    │       │   │   └── side-scroll-stages.md
    │       │   └── scripts/
    │       │       ├── compose_layered_preview.py
    │       │       └── extract_prop_pack.py
    │       ├── generate2dsprite/
    │       │   ├── LICENSE
    │       │   ├── SKILL.md
    │       │   ├── SOURCE.md
    │       │   ├── references/
    │       │   │   ├── modes.md
    │       │   │   └── prompt-rules.md
    │       │   └── scripts/
    │       │       ├── generate2dsprite.py
    │       │       └── make_layout_guide.py
    │       ├── imagine/
    │       │   └── SKILL.md
    │       ├── multiplayer-p2p/
    │       │   ├── SKILL.md
    │       │   └── references/
    │       │       ├── react-binding.md
    │       │       └── signaling-relay.md
    │       ├── neon/
    │       │   └── SKILL.md
    │       ├── og/
    │       │   ├── SKILL.md
    │       │   └── references/
    │       │       ├── brand-pass.md
    │       │       ├── custom-card.md
    │       │       ├── favicon-and-icons.md
    │       │       ├── og-type-contract.md
    │       │       ├── placeholder-card.md
    │       │       └── x-banner.md
    │       ├── threejs/
    │       │   └── SKILL.md
    │       ├── video2dsprite/
    │       │   ├── LICENSE
    │       │   ├── SKILL.md
    │       │   ├── SOURCE.md
    │       │   ├── references/
    │       │   │   ├── pipeline.md
    │       │   │   └── prompt-rules.md
    │       │   └── scripts/
    │       │       └── video2dsprite.py
    │       └── xai-api/
    │           └── SKILL.md
    └── .impeccable/
        └── config.json
