/**
 * Local email/password sign-in (this app's Better Auth DB — not the broker).
 *
 * Off by default. To enable: set `emailAndPasswordEnabled` to `true` below,
 * then build sign-up / sign-in forms with `authClient.signUp.email` /
 * `authClient.signIn.email` from `@/lib/auth/client` (see the auth skill).
 *
 * Do NOT edit `server.ts` for this — that file is frozen pre-wired config.
 */
/** E2E-only: programmatic sign-in for Playwright (never enabled in production builds). */
export const emailAndPasswordEnabled =
  typeof process !== "undefined" && process.env.MEETHINT_E2E === "1";
