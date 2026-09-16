import { isAuthenticatedWorkspaceId } from "../auth/anonymous-tier.ts";

/** Gate signup telemetry on a verified authenticated account (not dev-user / ws_anon_*). */
export function shouldRecordAuthenticatedSignup(input: {
  ready: boolean;
  accountId: string | null;
  hasUser: boolean;
  authEnabled: boolean;
}): boolean {
  if (!input.ready || !input.accountId || !input.hasUser) return false;
  if (input.authEnabled && !isAuthenticatedWorkspaceId(input.accountId)) return false;
  return true;
}
