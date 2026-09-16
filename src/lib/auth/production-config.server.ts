import { emailAndPasswordEnabled } from "./email-password.ts";

const PRODUCTION_HOSTS = new Set(["meethint.ai", "www.meethint.ai"]);

function env(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

export type ProductionAuthConfigReport = {
  /** Client flag resolved at build/deploy (`VITE_AUTH_ENABLED !== "false"`). */
  authEnabled: boolean;
  /** Server-side federated auth is active (Google direct or Grok broker). */
  authConfigured: boolean;
  databaseConfigured: boolean;
  secretConfigured: boolean;
  betterAuthUrlConfigured: boolean;
  googleDirect: boolean;
  grokBrokerConfigured: boolean;
  oauthReady: boolean;
  emailPasswordEnabled: boolean;
  /** Auth disabled while DATABASE_URL is set — server refuses dev-user. */
  failClosedOnMisconfig: boolean;
  /** True when auth-enabled deploy would still expose dev-user fallback paths. */
  devUserFallbackBlocked: boolean;
  onProductionHost: boolean;
  cookieSecure: boolean;
  cookieSameSite: "lax";
  sessionCookieName: string;
  /** Human-readable blockers for beta/production sign-in. */
  blockers: string[];
};

export function assessProductionAuthConfig(request: Request): ProductionAuthConfigReport {
  const host = new URL(request.url).hostname.toLowerCase();
  const onProductionHost = PRODUCTION_HOSTS.has(host);
  const authEnabled = env("VITE_AUTH_ENABLED") !== "false";
  const databaseConfigured = Boolean(env("DATABASE_URL"));
  const secretConfigured = Boolean(env("BETTER_AUTH_SECRET"));
  const betterAuthUrlConfigured = Boolean(env("BETTER_AUTH_URL"));
  const googleDirect = Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));
  const grokClientId = env("GROK_AUTH_CLIENT_ID") ?? "grok_preview";
  const grokSecretConfigured = Boolean(env("GROK_AUTH_CLIENT_SECRET"));
  const grokBrokerConfigured =
    authEnabled && !googleDirect && Boolean(grokClientId && grokSecretConfigured);
  const authConfigured = authEnabled && (googleDirect || grokBrokerConfigured);
  const oauthReady = googleDirect || (!onProductionHost || grokClientId !== "grok_preview");
  const failClosedOnMisconfig = databaseConfigured && !authConfigured;
  const devUserFallbackBlocked = authEnabled || failClosedOnMisconfig;

  const blockers: string[] = [];
  if (!authEnabled) blockers.push("VITE_AUTH_ENABLED=false");
  if (authEnabled && !authConfigured && !emailAndPasswordEnabled) {
    blockers.push("oauth-not-configured");
  }
  if (onProductionHost && authEnabled && !oauthReady) blockers.push("missing-production-oauth-client");
  if (onProductionHost && authEnabled && !databaseConfigured) blockers.push("missing-database-url");
  if (onProductionHost && authEnabled && !secretConfigured) blockers.push("missing-better-auth-secret");
  if (onProductionHost && authEnabled && !betterAuthUrlConfigured) {
    blockers.push("missing-better-auth-url");
  }
  if (failClosedOnMisconfig) blockers.push("fail-closed-auth-disabled-with-database");

  return {
    authEnabled,
    authConfigured,
    databaseConfigured,
    secretConfigured,
    betterAuthUrlConfigured,
    googleDirect,
    grokBrokerConfigured,
    oauthReady,
    emailPasswordEnabled: emailAndPasswordEnabled,
    failClosedOnMisconfig,
    devUserFallbackBlocked,
    onProductionHost,
    cookieSecure: true,
    cookieSameSite: "lax",
    sessionCookieName: "__Host-grok-auth.session_token",
    blockers,
  };
}
