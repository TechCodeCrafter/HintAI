# Tenant isolation

## Boundary

| Layer | Enforcement |
|-------|-------------|
| **Identity** | Server-verified `userId` from Better Auth session (`requireUserId` / `authMiddleware`). Never bind the IndexedDB vault from client-supplied ids alone when auth is on. |
| **Workspace** | Personal workspace id **equals** verified `userId` (1:1). Created implicitly on first verified session — no separate signup step. |
| **Corpus storage** | Separate IndexedDB per account: `meethint.<userId>`, `meethint-vectors.<userId>`. |
| **Retrieval** | `retrieveHits()` requires `scope: { workspaceId, contextId }`. Foreign-stamped chunks are **dropped before** ranking; the ranked set is re-checked. |
| **Embeddings cache** | Keys `{workspaceId}:{contextId}:{chunkId}` in the account-scoped vector DB. |
| **Server Postgres** | Better Auth tables (`user`, `session`, …) only. **No corpus in Postgres today.** |

## Postgres Row Level Security

**Decision: do not add RLS to Better Auth tables or introduce Postgres corpus tables in this milestone.**

- User corpus (repos, chunks, embeddings, meetings, answers) lives in **browser IndexedDB**, not Postgres.
- Better Auth owns its schema; wrapping those tables in custom RLS risks breaking session resolution and migrations.
- `waitlist` already has RLS (insert-only, no read policy) — appropriate for an unowned public table.
- When/if corpus moves server-side, new tables must include `workspace_id NOT NULL`, scoped queries in every handler, **and** RLS as defense-in-depth after query patterns are proven.

## Known limitations

- Auth defaults off (`VITE_AUTH_ENABLED=false`): all visitors share `dev-user` on one origin — dev only.
- `/api/auth/*` must be mounted for production auth (see `src/routes/api/auth/$.ts`).
- Team/shared workspaces (multi-member) are Phase 1 — not this milestone.
- `retrieve()` (lexical-only, untagged chunks) remains for unit tests; live search uses `retrieveHits()` only.

## Cross-user exposure risks (mitigated vs open)

| Risk | Mitigation |
|------|------------|
| Shared `dev-user` vault | Enable auth in deploy; fail-closed when `DATABASE_URL` set without auth |
| Client-forged user id | `resolveWorkspaceIdentity` server fn; vault binds server id |
| Guessed context UUID | `getContext` returns null when row belongs to another workspace |
| Cross-workspace retrieve | `filterChunksForScope` before rank + tagged chunks from `indexContext` |
| Embedding cache bleed | Scoped vector keys + per-account vector DB |
| Legacy global `ground.pack` | Migrated once into bound account; wiped on logout |

## Adversarial red teaming

Deterministic isolation tests: `tenant-isolation.test.ts`, `redteam-harness.test.ts`.
For DeepTeam adversarial runs (prompt injection, corpus poisoning), see **[RED-TEAM.md](./RED-TEAM.md)**.
