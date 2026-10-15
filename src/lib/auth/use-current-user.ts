import { useMemo } from "react";
import { authClient, authEnabled } from "./client";

/** Normalized user shape used across the app, auth on or off. */
export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
  /** True when this is the sandbox/dev fallback (auth not configured). */
  isDevFallback: boolean;
};

/**
 * Stable fallback user, used ONLY when auth is disabled
 * (`VITE_AUTH_ENABLED=false`, the shipped default). With auth on, the sandbox
 * live preview does real sign-in via the baked preview client. Its id is
 * `"dev-user"` — the SAME id `verify.server.ts` returns server-side — so per-user
 * rows written in that mode belong to one consistent owner.
 */
export const DEV_USER: AppUser = {
  id: "dev-user",
  displayName: "Dev User",
  primaryEmail: "dev@example.com",
  profileImageUrl: null,
  isDevFallback: true,
};

/**
 * Stable `CurrentUserState` for the auth-disabled path. Returning a fresh object
 * literal here would give every consumer a new identity on every render, the
 * same class of bug the memoised path below avoids.
 */

/** `useCurrentUserState()` result: the user plus the session-loading flag. */
export type CurrentUserState = {
  /** The user — `null` BOTH while the session loads and when signed out. */
  user: AppUser | null;
  /** True while the session is still resolving — don't treat `user: null` as signed out yet. */
  isPending: boolean;
};

/**
 * Current user + loading state. Same behavior in live preview and when deployed:
 *   - Auth enabled -> the real signed-in user; `user` is `null` while
 *                            the session resolves (`isPending: true`) and when
 *                            signed out (`isPending: false`). Session comes from
 *                            Better Auth `useSession()` → `/api/auth/get-session`
 *                            (cookie when deployed; bearer in live preview).
 *   - Auth disabled (`VITE_AUTH_ENABLED=false`) -> `DEV_USER`, never pending.
 *
 * Protect a route by waiting out `isPending` before acting on `user` —
 * redirecting on `user: null` alone bounces signed-in visitors to sign-in on
 * every hard reload:
 *
 *   import { RedirectToSignIn } from "@/lib/auth/gates";
 *   const { user, isPending } = useCurrentUserState();
 *   if (isPending) return null;              // still resolving — don't redirect yet
 *   if (!user) return <RedirectToSignIn />;  // definitely signed out
 *
 * `authEnabled` is a module-level constant fixed at load, so the guarded hook
 * call keeps a stable hook order across every render of a given component.
 */
export function useCurrentUserState(): CurrentUserState {
  // Returned inline on purpose. `DEV_USER` is a module constant, so the `user`
  // identity consumers depend on is stable here; only the wrapper is fresh, and
  // nothing puts the wrapper in a dependency array.
  //
  // scripts/check-production-auth-build.mjs asserts this exact line text as a
  // production auth gate, so it must not be rewritten to a named constant.
  if (!authEnabled) return { user: DEV_USER, isPending: false };
  // eslint-disable-next-line react-hooks/rules-of-hooks -- authEnabled is constant for the app's lifetime
  const { data, isPending } = authClient.useSession();
  const raw = data?.user;
  // Memoise on the primitive fields, not on `raw`. Better Auth can hand back a
  // fresh session object on every refetch, and mapping it inline produced a new
  // `user` identity on every render. Consumers put `user` in dependency arrays
  // (`useAccountVaultReady`, `beta-telemetry-boot`), so a new identity re-ran
  // their effects each render. `useAccountVaultReady` sets state on success, so
  // that became an infinite render loop hammering `resolveWorkspaceIdentity`.
  const user = useMemo<AppUser | null>(
    () =>
      raw
        ? {
            id: raw.id,
            displayName: raw.name ?? null,
            primaryEmail: raw.email ?? null,
            profileImageUrl: raw.image ?? null,
            isDevFallback: false,
          }
        : null,
    [raw?.id, raw?.name, raw?.email, raw?.image],
  );
  return useMemo(() => ({ user, isPending }), [user, isPending]);
}

/**
 * Convenience view of `useCurrentUserState().user` for display (e.g.
 * `user?.displayName ?? "Guest"`). NOTE: `null` means *loading OR signed out* —
 * for redirects/guards use `useCurrentUserState()` and check `isPending`.
 */
export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}
