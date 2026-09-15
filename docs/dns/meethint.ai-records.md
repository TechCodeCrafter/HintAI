# meethint.ai — DNS & mail records

**Registrar / DNS:** Namecheap (`dns1.registrar-servers.com`)  
**Web:** Vercel (apex `A` → `76.76.21.21`, `www` CNAME → `*.vercel-dns.com`)

Two tiers: **launch (free/near-zero)** using existing Namecheap forwarding, and **paid upgrade later** when you need authenticated outbound mail.

---

## Launch setup — Namecheap Email Forwarding (recommended for now)

**Cost:** $0 incremental (uses Namecheap domain forwarding included with registration).  
**Good for:** receiving security/abuse reports at `@meethint.ai` aliases.  
**Not good for:** sending production transactional mail *as* `@meethint.ai` (no DKIM on this path).

### 1. Create forwards (Namecheap → Domain → Manage → Email Forwarding)

| Alias | Forwards to | Notes |
|-------|-------------|-------|
| `security@meethint.ai` | Owner inbox (e.g. personal Gmail) | Required for Phase B |
| `abuse@meethint.ai` | Owner inbox (same or separate) | Required for Phase B |
| `dmarc-reports@meethint.ai` | Owner inbox | For DMARC RUA (optional at launch) |
| `support@meethint.ai` | Owner inbox | Optional — product mail |
| `hello@meethint.ai` | Owner inbox | Optional — general contact |

**Do not publish mailto addresses** on the site until inbound delivery is tested.

### 2. MX — keep existing (do not change if forwarding works)

Namecheap forwarding uses:

```
eforward1.registrar-servers.com  (priority 10)
eforward2.registrar-servers.com  (priority 10)
eforward3.registrar-servers.com  (priority 10)
eforward4.registrar-servers.com  (priority 15)
eforward5.registrar-servers.com  (priority 20)
```

If these already exist and forwards receive mail, **leave them**.

### 3. SPF — one TXT at `@` (likely already correct)

```txt
v=spf1 include:spf.efwd.registrar-servers.com ~all
```

Rules:

- **Exactly one** SPF TXT at the apex  
- Keep `~all` at launch (not `+all`, not `-all` until you operate authenticated outbound mail)  
- Do **not** add Google/Cloudflare includes while still on forwarding-only MX

Verify: `dig TXT +short meethint.ai | grep spf`

### 4. DMARC — add monitoring policy

Add TXT at `_dmarc.meethint.ai`:

```txt
v=DMARC1; p=none; rua=mailto:dmarc-reports@meethint.ai; adkim=r; aspf=r; pct=100
```

Use `adkim=r` / `aspf=r` (relaxed) at launch because **DKIM is not available** on forwarding-only.

**Do not** move to `p=quarantine` or `p=reject` until a paid provider signs mail with DKIM.

### 5. DKIM — defer at launch

Namecheap email **forwarding does not sign outbound mail** as `@meethint.ai`.

| Use case | Launch forwarding OK? |
|----------|------------------------|
| **Inbound** security/abuse reports to `security@` / `abuse@` | Yes — after forward test |
| **Outbound transactional** (password reset, waitlist, support) from `@meethint.ai` | **No** — requires paid provider + DKIM first |
| **Reply** from your personal inbox to reporters | Yes — mail shows your personal From, not `@meethint.ai` |

Document in runbooks: **do not send production outbound mail From `@meethint.ai` until DKIM is enabled** (paid tier below).

### 6. CAA — add at apex (safe for Vercel TLS)

| Host | Flags | Tag | Value |
|------|-------|-----|-------|
| `@` | 0 | issue | `letsencrypt.org` |

Vercel provisions certificates via Let's Encrypt. Do not publish CAA that omits `letsencrypt.org`.

Verify: `dig CAA +short meethint.ai`

### 7. DNSSEC — optional, after DNS stable

Namecheap BasicDNS: Advanced DNS → DNSSEC toggle. Defer until MX/SPF/DMARC/CAA are stable.

---

## Launch verification (manual + script)

**Inbound only** (required before publishing mailto):

1. From external Gmail/Outlook → send to `security@meethint.ai` → arrives at destination inbox  
2. Repeat for `abuse@meethint.ai`  
3. Check spam folder  

```bash
npm run verify:domain-email                    # default: launch profile
npm run verify:domain-email -- --expect-mail   # after forwards + DMARC + CAA
npm run publish:mail-contacts                    # publishes mailto + verified=true
npm run build && deploy
```

---

## Paid upgrade later (when outbound `@meethint.ai` mail matters)

Upgrade when you need any of:

- Support/waitlist/transactional mail **From** `@meethint.ai`  
- DKIM-aligned outbound with DMARC `p=quarantine` / `p=reject`  
- Shared team inbox, SLA, compliance audit trail  

**Not a launch blocker.** GitHub Security Advisories remain a valid channel until then.

### Option A — Google Workspace (~$7/user/mo)

See [Google Workspace admin](https://workspace.google.com). Replace MX with Google ASPMX hosts, SPF `include:_spf.google.com`, enable DKIM selector `google`, tighten DMARC after alignment.

### Option B — Cloudflare Email Routing (free tier)

Requires moving DNS to Cloudflare nameservers. MX → `route*.mx.cloudflare.net`, SPF `include:_spf.mx.cloudflare.net`.

### Option C — Fastmail / Migadu / Zoho Mail

Similar pattern: provider MX + SPF include + DKIM TXT from dashboard.

After cutover, run:

```bash
npm run verify:domain-email -- --provider google   # or cloudflare
```

Full paid-record templates are unchanged from provider docs; launch forwarding records above are replaced.

---

## DMARC rollout (paid tier only)

1. `p=none` — monitor RUA 2–4 weeks  
2. `p=quarantine; pct=25` → increase  
3. `p=reject` when SPF **and** DKIM alignment pass consistently  
4. SPF `~all` → `-all` when outbound is fully authenticated
