# Enterprise allowlisting — MeetHint (`meethint.ai`)

This document helps corporate security and IT teams evaluate **MeetHint** for allowlisting. It does **not** ask you to bypass your security policy — apply your organization's normal review process.

## Product summary

**MeetHint** is a browser-based meeting copilot. Users load their own documents and repos locally; the product searches that material and surfaces **cited answers or intentional silence**. Production web app and marketing site: **https://www.meethint.ai**.

## Official domains

| Domain | Purpose |
|--------|---------|
| `meethint.ai` | Registered apex (redirects to www in production) |
| `www.meethint.ai` | Production marketing + web application |

No other first-party production domains are in use today. Do not allowlist `grok.com`, `*.grok.me`, or builder preview hosts for production MeetHint traffic.

## Why you may see “Newly Observed Domain” (NOD)

`meethint.ai` is a recently registered domain. Many secure web gateways (Zscaler, Palo Alto, Cisco Umbrella, Microsoft Defender, etc.) classify NODs as suspicious until:

- The domain accumulates age and benign reputation  
- DNS/email authentication (SPF, DKIM, DMARC) is visible  
- Public trust pages and security contact exist  

MeetHint Phase A removed unrelated third-party scripts from production HTML. Phase B adds verified `@meethint.ai` mail and aligned DNS authentication.

## Security and abuse contacts

| Channel | Address / URL | Status |
|---------|---------------|--------|
| Security reports (primary after Phase B mail verification) | `security@meethint.ai` | Activate with Phase B DNS/mail |
| Abuse | `abuse@meethint.ai` | Activate with Phase B DNS/mail |
| Security reports (secondary, always available) | [GitHub Security Advisories](https://github.com/TechCodeCrafter/HintAI/security/advisories/new) | Active |
| Product questions | [GitHub Issues](https://github.com/TechCodeCrafter/HintAI/issues) | Active |
| Machine-readable | `https://www.meethint.ai/.well-known/security.txt` | Active |

Optional product addresses (not required for security review): `support@meethint.ai`, `hello@meethint.ai` — create if you need a dedicated support line.

## Recommended allowlisting (web)

If your policy permits, allow **HTTPS** access to:

```
https://meethint.ai
https://www.meethint.ai
https://www.meethint.ai/home
https://www.meethint.ai/app
https://www.meethint.ai/privacy
https://www.meethint.ai/terms
https://www.meethint.ai/security
https://www.meethint.ai/contact
https://www.meethint.ai/.well-known/security.txt
```

**Category suggestion:** Business / Productivity / SaaS (not generic “Newly Registered” or “Uncategorized” if your vendor supports recategorization).

## Necessary third-party endpoints (application runtime)

Users may optionally configure API keys; traffic goes **from the user's browser** to these providers (not MeetHint-operated backends for LLM calls):

| Domain | Purpose | Required? |
|--------|---------|-------------|
| `api.openai.com` | Optional OpenAI answers / embeddings | User opt-in |
| `api.anthropic.com` | Optional Anthropic answers | User opt-in |
| `api.x.ai` | Optional xAI answers / STT | User opt-in |
| `huggingface.co` | Embedding model download | App feature |
| `cdn-lfs.huggingface.co` | Model weight files | App feature |

Marketing pages (`/`, trust routes) are **first-party only** — no Google Fonts, no `grok.com` scripts, no jsDelivr.

Full inventory: [DOMAIN-REPUTATION.md](./DOMAIN-REPUTATION.md).

## Email authentication (for teams that filter on domain reputation)

**Launch (current):** Namecheap email forwarding — inbound `security@` / `abuse@` only.

| Record | Launch value |
|--------|--------------|
| **MX** | `eforward*.registrar-servers.com` |
| **SPF** | `v=spf1 include:spf.efwd.registrar-servers.com ~all` |
| **DKIM** | Not available on forwarding — **deferred** |
| **DMARC** | `_dmarc.meethint.ai` with `p=none` (relaxed alignment) |

**Paid upgrade (later):** Google Workspace or similar adds DKIM + authenticated outbound `@meethint.ai` mail. Not required for launch or security report intake.

Verify live: `npm run verify:domain-email` (launch profile)

## TLS / certificate issuance

Production TLS is provisioned by **Vercel** via **Let's Encrypt**. Apex DNS includes (or should include) CAA:

```txt
0 issue "letsencrypt.org"
```

## Your policy applies

- MeetHint does not request exemption from malware scanning, TLS inspection, or DLP.  
- Use this document as evidence during **your** vendor review — not as instruction to disable controls.  
- For custom enterprise deployments (VPC, SSO-only), contact paths above after mail is live.

## Related documentation

- [DOMAIN-REPUTATION.md](./DOMAIN-REPUTATION.md) — full ticket #25 program  
- [dns/meethint.ai-records.md](./dns/meethint.ai-records.md) — DNS record templates  
