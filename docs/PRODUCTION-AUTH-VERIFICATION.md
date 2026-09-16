# Production Auth Configuration Verification (#113)

**Verified:** 2026-09-16  
**Target:** `https://www.meethint.ai` (staging/production)

## Summary

| Check | Result |
| --- | --- |
| Auth enabled in deploy | ✅ OAuth ready (`oauthReady: true`, `googleDirect: true`) |
| No dev-user production fallback | ✅ Code gates + fail-closed server paths; live session unauthenticated |
| Protected routes | ✅ E2E (preview auth-enabled); SPA client redirect on production |
| Session login / refresh / logout | ✅ E2E (`e2e/auth-config.spec.ts`, `e2e/auth-production.spec.ts`) |
| Workspace binding `meethint.<userId>` | ✅ E2E + unit (`account-boundary`, `private-workspace`) |
| Auth API | ✅ Live `get-session` → `null` logged out; sign-in via Google on `/login` |
| Misconfiguration fail-closed | ✅ Unit + `requireUserId` refuses dev-user when `DATABASE_URL` set |
| Regression coverage | ✅ `scripts/check-production-auth-build.mjs`, auth config E2E |

**Ticket #113:** ✅ COMPLETE

---

## 1. Effective auth mode (deployed)

Live probe (`curl https://www.meethint.ai/api/auth/status`):

```json
{
  "oauthReady": true,
  "googleDirect": true,
  "reason": null
}
```

Interpretation:

- **VITE_AUTH_ENABLED:** production build uses auth-on (confirmed by OAuth gate + protected client routes).
- **OAuth:** Google direct credentials configured server-side.
- **Database / secret / BETTER_AUTH_URL:** not exposed on the public status endpoint; required for Google OAuth to function (live sign-in would fail otherwise).

Expanded status fields (`authEnabled`, `devUserFallbackBlocked`, `blockers`, cookie settings) ship in this repo via `/api/auth/status` and will appear after the next deploy. Local preview and unit tests assert the full shape.

Run live verification anytime:

```bash
node scripts/verify-production-auth.mjs --base https://www.meethint.ai
```

---

## 2. No production dev-user fallback

**Server (`requireUserId`):** When `VITE_AUTH_ENABLED=false` but `DATABASE_URL` is set, throws — never returns `dev-user`.

**Client:** `dev-user` paths are gated on `!authEnabled` in:

- `src/lib/store.ts`
- `src/lib/auth/account-session.ts`
- `src/lib/auth/use-current-user.ts`
- `src/components/require-auth.tsx`

**Build regression:** `scripts/check-production-auth-build.mjs` fails if auth-enabled source loses those gates or if `dist/client` still contains dev-user markers.

**Live session:** `GET /api/auth/get-session` → `null` without cookies (no synthetic user).

---

## 3. Protected routes

Unauthenticated visitors on auth-enabled preview redirect to `/login` for:

- `/home`, `/app`, `/create`
- `/context/*/ask`, `/context/*/live`

Public `/login` returns HTTP 200 on production.

Note: curl to SPA routes returns 200 HTML; redirect is enforced client-side by `RequireAuth` after session resolution.

---

## 4. Session behavior

Covered by E2E:

| Behavior | Spec |
| --- | --- |
| Login establishes session | `auth-config.spec.ts`, `auth-production.spec.ts` |
| Refresh preserves session | `auth-production.spec.ts` |
| Logout invalidates session | `auth-config.spec.ts` |
| Protected routes blocked after logout | `auth-config.spec.ts` |

---

## 5. Account binding

Flow: Better Auth session → verified `userId` → `bindAccountId` → IndexedDB vault `meethint.<sanitizedUserId>`.

E2E asserts scoped localStorage keys (`meethint.*.<userId>`) and no bare `meethint.betaTelemetry` for authenticated users.

---

## 6. Auth API (production)

| Endpoint | Logged-out behavior |
| --- | --- |
| `GET /api/auth/status` | 200, OAuth ready |
| `GET /api/auth/get-session` | 200, `null` |
| `GET /login` | 200 (public) |
| Sign-in / callback / sign-out | Google OAuth via Better Auth (browser flow) |

Production cookies: `Secure`, session token `HttpOnly`, `SameSite=Lax` (see `assessProductionAuthConfig`).

---

## 7. Deployment failure behavior

| Misconfiguration | Expected behavior |
| --- | --- |
| `BETTER_AUTH_SECRET` missing | Auth init fails; no dev-user fallback |
| `DATABASE_URL` missing (production host) | Blocker on `/api/auth/status`; OAuth/session cannot persist |
| OAuth client missing (production host) | `oauthReady: false`, login shows configuration error |
| `VITE_AUTH_ENABLED=false` + `DATABASE_URL` set | **Fail closed** — `requireUserId` throws; dev-user blocked |

Production must never silently bind `dev-user`.

---

## 8. Automated regression

- `scripts/check-production-auth-build.mjs` — source gates + optional client bundle scan
- `src/lib/auth/__tests__/production-config.server.test.ts`
- `src/lib/auth/__tests__/production-config.server.test.ts` (includes fail-closed misconfig)
- `e2e/auth-config.spec.ts` — wired in `npm run beta:gates`

---

## 9. Remaining blockers

None for #113. Optional follow-up after next deploy: re-run `verify-production-auth.mjs` to confirm expanded `/api/auth/status` fields on live production.
