# Domain Reputation & Enterprise Security Compatibility

Ticket **#25** — make `meethint.ai` look and behave like a clean, first-party SaaS surface so enterprise web filters, security teams, and users can trust the domain.

## Why this work exists

- **Newly Observed Domain (NOD)** warnings: `meethint.ai` is a recently registered production hostname. Many enterprise proxies (Zscaler, Palo Alto, Cisco Umbrella, etc.) treat NODs as suspicious until reputation builds.
- **Third-party executable scripts** (especially from unrelated domains like `grok.com`) increase block scores and look like typosquatting or piggybacked tooling.
- **Missing trust surfaces** (privacy, terms, security contact, `security.txt`) signal an unfinished or non-enterprise product to IT reviewers.

This document tracks Phase A (shipped in repo) and follow-on phases that require registrar, email, or vendor access.

## Current known warning

| Signal | Status |
|--------|--------|
| Newly Observed Domain | Expected until age + benign traffic accumulate |
| Grok App Builder `extensions.js` on production | **Removed (Phase A)** — gated to `*.grok.me` and opt-in localhost |
| Google Fonts on marketing HTML | **Removed (Phase A)** — self-hosted via `@fontsource/*` |
| Missing `/privacy`, `/terms`, `/security`, `/contact` | **Fixed (Phase A)** |
| Missing `/.well-known/security.txt` | **Added (Phase A)** — GitHub Security Advisories until Phase B mail |
| DMARC / SPF alignment | **Phase B** — registrar / email provider |
| SOC 2 / compliance claims | **Not claimed** — do not add until certified |

## Phase A implementation (this branch)

1. **Grok executable gating** — `shouldInjectGrokBuilderChrome()` in `scripts/security-headers.mjs`; production hosts `meethint.ai` / `www.meethint.ai` never receive `https://grok.com/grok-app-builder/extensions.js`.
2. **Trust routes** — `/privacy`, `/terms`, `/security`, `/contact` (public, no auth).
3. **`/.well-known/security.txt`** — GitHub Security Advisories + Issues (working now); dedicated mail in Phase B.
4. **Footer links** — real routes, no `#security` placeholders for Privacy.
5. **Security headers** — CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` via Nitro middleware + Vite preview plugin. **HSTS** remains at the CDN / Vercel layer (unchanged).
6. **Self-hosted fonts** — `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`, `@fontsource/jetbrains-mono`.
7. **Regression tests** — `scripts/domain-reputation.test.mjs`, `e2e/domain-reputation.spec.ts`, extended `scripts/grok-pwa-plugin.test.mjs`.
8. **First-party demo media** — landing video served from `/demo/*`; `scripts/copy-demo-media.mjs` restores mp4 at build time (no jsDelivr).
9. **External theme boot** — `/theme-boot.js` replaces inline theme script in `__root.tsx`.

### CSP summary

**Marketing / legal** (`meethint.ai` + `/`, `/privacy`, `/terms`, `/security`, `/contact`):

```
default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none';
script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:
```

**App surfaces** (`/home`, `/app`, …):

Same as marketing, plus:

- `script-src … 'unsafe-inline' 'wasm-unsafe-eval'` (see audit below)
- `style-src 'self' 'unsafe-inline'` (React inline styles + auth popup HTML)
- `connect-src` allows documented provider APIs (see inventory below)

### CSP `'unsafe-inline'` audit

| Surface | Directive | Required? | Source | Notes |
|---------|-----------|-----------|--------|-------|
| Marketing | `script-src 'unsafe-inline'` | **Yes (kept)** | TanStack Start `$tsr-stream-barrier` inline bootstrap | Injected on every SSR HTML document; content includes build-specific asset hashes. TanStack Start does not expose nonce/hash configuration in this app. Cannot remove without framework support or per-build hash injection middleware. |
| Marketing | `script-src 'self'` | **Yes** | `/theme-boot.js`, `/assets/*.js` | Theme boot was moved out of inline `<script>` (formerly `THEME_BOOT` in `__root.tsx`). |
| Marketing | `style-src 'self'` only | **Yes (no unsafe-inline)** | `/assets/*.css`, `@fontsource/*` | Trust/landing pages use Tailwind classes only — no inline `<style>` or `style=""` attributes. |
| App | `script-src 'unsafe-inline'` | **Yes (kept)** | `$tsr-stream-barrier` + `/auth/popup` completion page | Popup route (`src/lib/auth/popup.server.ts`) emits inline `<script>` and `<style>` for OAuth handoff. |
| App | `style-src 'unsafe-inline'` | **Yes (kept)** | React `style={{…}}` props, auth popup | Used in cockpit/PDF viewer and other interactive surfaces. Removing would break layout without a large refactor to CSS classes. |
| App | `script-src 'wasm-unsafe-eval'` | **Yes** | ONNX / in-browser ML (VAD, embeddings) | Required for WebAssembly modules; not `'unsafe-eval'`. |

## External-domain inventory (production)

| Domain | Type | Category | Reason | CSP |
|--------|------|----------|--------|-----|
| *(none on marketing HTML)* | — | — | First-party only after Phase A | — |
| `meethint.ai` / `www.meethint.ai` | HTML, JS, CSS, fonts, images | **Required** | First-party origin | `'self'` |
| `api.openai.com` | API (fetch) | **Required** (app, user key) | Optional OpenAI answers / embeddings | `connect-src` (app CSP) |
| `api.anthropic.com` | API (fetch) | **Required** (app, user key) | Optional Anthropic answers | `connect-src` (app CSP) |
| `api.x.ai` | API (fetch) | **Required** (app, user key) | Optional xAI answers / STT | `connect-src` (app CSP) |
| `huggingface.co` | API / model registry | **Required** (app) | Local embedding model download | `connect-src` (app CSP) |
| `cdn-lfs.huggingface.co` | CDN (models) | **Required** (app) | Model weight files | `connect-src` (app CSP) |
| `cdn.jsdelivr.net` | CDN | **Removed** | Was used for landing demo mp4; now first-party `/demo/*` | Not allowed |
| `grok.com` | Script | **Removable on production** | Grok App Builder chrome — **gated off** for `meethint.ai` | Not allowed |
| `og.grok.me` | Image (OG placeholder) | **Removable on production** | Only used for `*.grok.me` preview hosts | Not used on meethint.ai |
| `fonts.googleapis.com` | CSS / font | **Removed** | Was in `__root.tsx`; now self-hosted | Not allowed |
| `fonts.gstatic.com` | Font files | **Removed** | Google Fonts companion | Not allowed |

### Self-hostable follow-ups (optional)

| Asset | Current | Notes |
|-------|---------|-------|
| Hugging Face models | Remote fetch | Could bundle small models; large ONNX stays remote |

## Known limitations (Phase A)

- Security contact is **GitHub Security Advisories** until Phase B mail forwarding is verified and published (Phase B on hold — see below).
- HSTS is configured at deploy/CDN; not duplicated in app middleware (intentional — avoid conflicting max-age).
- Enterprise allowlist pack for IT (full URL/domain CSV) is documented here but not yet published as a separate vendor-facing PDF.
- Domain age and NOD clearance require time and benign traffic — no code fix.

## Phase B — domain / email identity (**on hold**)

**Goal:** working `security@` / `abuse@` contacts and baseline DNS authentication **without paid mail as a launch blocker**.

**Status (2026-09-14):** DNS authentication records are live. Remaining mailbox/forwarding work is **deferred manual ops** — product focus returned to core roadmap (Knowledge Spaces / Milestone 2).

### Completed (registrar — keep)

| Step | Action | Status |
|------|--------|--------|
| MX | Keep `eforward*.registrar-servers.com` | **Live** |
| SPF | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | **Live** |
| DMARC | `_dmarc` TXT with `p=none` | **Live** |
| CAA | `0 issue "letsencrypt.org"` @ apex | **Live** |

Live DMARC record:

```txt
v=DMARC1; p=none; rua=mailto:dmarc-reports@meethint.ai; adkim=r; aspf=r; pct=100
```

### Deferred manual tasks (resume when prioritized)

| Task | Notes |
|------|-------|
| `security@meethint.ai` forwarding | Namecheap Email Forwarding → owner inbox; inbound test required |
| `abuse@meethint.ai` forwarding | Same |
| Mail contact publishing | `npm run publish:mail-contacts` + deploy — **only after** forwards verified |
| Outbound DKIM-capable email provider | Paid tier (Google Workspace, etc.) — not a launch blocker |

Tooling remains in repo (`verify:domain-email`, `publish:mail-contacts`); do **not** publish mailto on site until forwarding is confirmed.

### Launch setup reference (free / near-zero cost)

Uses **Namecheap Email Forwarding**. No Google Workspace required to ship.

| Step | Action | Status |
|------|--------|--------|
| Forwards | Create `security@`, `abuse@` → owner inbox | **Deferred** |
| DKIM | **Deferred** — forwarding does not sign outbound `@meethint.ai` | N/A at launch |
| Inbound test | External mail → `security@` / `abuse@` arrives | **Deferred** |
| Publish | `npm run publish:mail-contacts` after verify + inbound test | **Deferred** |

**DKIM policy at launch:** inbound security/abuse forwarding is OK. **Do not** send production transactional or support mail **From** `@meethint.ai` until a paid provider enables DKIM (see paid tier below).

Exact records: **[docs/dns/meethint.ai-records.md](./dns/meethint.ai-records.md)**

### Paid mail setup (later — not a launch blocker)

Upgrade when you need outbound mail **as** `@meethint.ai` (waitlist, support, transactional), DKIM alignment, or stricter DMARC (`quarantine` / `reject`).

| Provider | Typical cost | When |
|----------|--------------|------|
| Google Workspace | ~$7/user/mo | Team inbox + DKIM + outbound |
| Cloudflare Email Routing | Free (DNS on Cloudflare) | Budget outbound routing |
| Fastmail / Zoho / Migadu | Varies | Alternative hosted mail |

After upgrade: replace MX/SPF, enable DKIM, tighten DMARC. Verify with `npm run verify:domain-email -- --provider google`.

### Live DNS snapshot (2026-09-14)

| Record | Current |
|--------|---------|
| **MX** | `eforward*.registrar-servers.com` |
| **SPF** | `v=spf1 include:spf.efwd.registrar-servers.com ~all` |
| **DKIM** | *(none — deferred)* |
| **DMARC** | `v=DMARC1; p=none; rua=mailto:dmarc-reports@meethint.ai; adkim=r; aspf=r; pct=100` |
| **CAA** | `0 issue "letsencrypt.org"` |
| **DNSSEC** | *(none — optional)* |

**Registrar:** Namecheap · **Web:** Vercel

### Mailbox status

| Address | Forward configured | Public mailto | Inbound verified |
|---------|-------------------|---------------|------------------|
| `security@meethint.ai` | Deferred | **No** | Deferred |
| `abuse@meethint.ai` | Deferred | **No** | Deferred |
| `support@meethint.ai` | Optional | **No** | Not required at launch |
| `hello@meethint.ai` | Optional | **No** | Not required at launch |

GitHub Security Advisories remain the public contact until forwarding is verified and mail is published.

### Verification tooling (when resuming Phase B)

```bash
npm run verify:domain-email                         # launch profile (default)
npm run verify:domain-email -- --provider google    # paid-tier check
npm run publish:mail-contacts                       # after inbound tests pass
```

Not part of `npm test` (live DNS).

### Phase B checklist

- [x] DMARC `_dmarc` with `p=none`
- [x] CAA `letsencrypt.org` at apex
- [x] SPF + MX (Namecheap forwarding)
- [ ] **Deferred:** Namecheap forwards `security@`, `abuse@`
- [ ] **Deferred:** Inbound delivery test
- [ ] **Deferred:** `npm run publish:mail-contacts` + deploy
- [ ] **Deferred:** Outbound DKIM provider (paid tier)
- [ ] Share [ENTERPRISE-ALLOWLIST.md](./ENTERPRISE-ALLOWLIST.md) with IT reviewers

**Not in Phase B:** vendor recategorization (Phase C).

### DMARC rollout (paid tier only)

1. `p=none` at launch (relaxed alignment — no DKIM)  
2. After paid provider + DKIM: monitor RUA, move toward `adkim=s; aspf=s`  
3. `p=quarantine` → `p=reject` only with consistent SPF **and** DKIM pass  
4. SPF `-all` only with authenticated outbound mail

## Phase C — vendor matrix template

| Vendor / filter | Submission URL | Status | Notes |
|-----------------|----------------|--------|-------|
| Zscaler | *(URL)* | Not started | Category: Business / SaaS |
| Palo Alto URL Filtering | *(URL)* | Not started | |
| Cisco Umbrella | *(URL)* | Not started | |
| Microsoft Defender SmartScreen | *(URL)* | Not started | |
| Google Safe Browsing | *(URL)* | Not started | |
| Cloudflare Radar / categorization | *(URL)* | Not started | |

## Phase D — monitoring checklist

- [ ] Weekly HEAD request to `/` — verify security headers present
- [ ] Weekly fetch `/.well-known/security.txt` — verify not expired
- [ ] Monitor registrar expiry and auto-renew
- [ ] Alert on new third-party scripts in production HTML (CI regression)
- [ ] Track NOD / block reports from beta users
- [ ] Renew `security.txt` `Expires` before date (currently 2027-09-14)

## Post-deploy verification checklist

Run against production after each deploy that touches public surfaces or headers.

### URLs to check

| URL | Expected |
|-----|----------|
| `https://meethint.ai` | `301/308` → `https://www.meethint.ai/` (or `200` if apex serves directly) |
| `https://www.meethint.ai/` | `200` |
| `https://www.meethint.ai/privacy` | `200` |
| `https://www.meethint.ai/terms` | `200` |
| `https://www.meethint.ai/security` | `200` |
| `https://www.meethint.ai/contact` | `200` |
| `https://www.meethint.ai/.well-known/security.txt` | `200` |

### Headers (every HTML document above)

```bash
curl -sI https://www.meethint.ai/ | rg -i 'content-security-policy|strict-transport|x-content-type|referrer-policy|permissions-policy|x-frame-options'
```

Verify:

- [ ] `Content-Security-Policy` present — no `script-src *`, no `grok.com`, no `fonts.googleapis.com`, no `jsdelivr`
- [ ] `Strict-Transport-Security` present (CDN/Vercel — not app middleware)
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Permissions-Policy` present (camera denied, microphone self)
- [ ] `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`

### HTML content (landing `/`)

```bash
curl -s https://www.meethint.ai/ | rg -i 'grok\.com/grok-app-builder|fonts\.googleapis|fonts\.gstatic'
```

Verify:

- [ ] No `grok.com` executable script references
- [ ] No Google Fonts links
- [ ] Footer links: `/privacy`, `/terms`, `/security`, `/contact` (not `#security` for Privacy)
- [ ] Demo video `src="/demo/meethint-demo-cutaway.mp4"` (first-party)

### security.txt

- [ ] `Contact:` lines point to working GitHub URLs (not inactive mailboxes)
- [ ] `Expires` date in the future
- [ ] `Canonical` matches `https://www.meethint.ai/.well-known/security.txt`

## Related files

| File | Purpose |
|------|---------|
| `scripts/security-headers.mjs` | CSP + header builders, Grok gating |
| `server/middleware/0-security-headers.ts` | Production Nitro middleware |
| `scripts/security-headers-plugin.mjs` | Dev/preview header middleware |
| `scripts/grok-pwa-shared.mjs` | Head injection (host-aware) |
| `scripts/copy-demo-media.mjs` | Restore landing mp4 at build time |
| `public/theme-boot.js` | External theme bootstrap (CSP-friendly) |
| `public/.well-known/security.txt` | Security contact file |
| `config/mail-contacts.json` | Mail verification gate (verified flag) |
| `scripts/verify-domain-email.mjs` | Live DNS / security.txt ops check |
| `scripts/publish-mail-contacts.mjs` | Publish mailto after verification |
| `docs/ENTERPRISE-ALLOWLIST.md` | IT allowlisting guide |
| `docs/dns/meethint.ai-records.md` | Exact DNS templates |
| `src/routes/privacy.tsx` … `contact.tsx` | Trust pages |
| `scripts/domain-reputation.test.mjs` | Unit/regression tests |
| `e2e/domain-reputation.spec.ts` | HTTP-level checks (e2e job) |
