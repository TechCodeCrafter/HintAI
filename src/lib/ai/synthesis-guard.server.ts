import type { ProviderKeys } from "./models.ts";
import type { SynthesisDirectInput } from "./synthesis-client.ts";
import { gateIdentityEnabled } from "../auth/gate-identity.server.ts";

/** Hard caps — reject before any provider call. */
export const SYNTHESIS_LIMITS = {
  maxPromptChars: 24_000,
  maxQueryChars: 2_000,
  maxEvidenceChars: 20_000,
  maxRequestBodyChars: 32_000,
  maxClientKeyChars: 512,
} as const;

export type SynthesisGuardErrorCode =
  | "unauthorized"
  | "prompt_too_large"
  | "query_too_large"
  | "evidence_too_large"
  | "body_too_large"
  | "rate_limited";

export class SynthesisGuardError extends Error {
  readonly status: number;
  readonly code: SynthesisGuardErrorCode;

  constructor(code: SynthesisGuardErrorCode, message: string, status = 400) {
    super(message);
    this.name = "SynthesisGuardError";
    this.code = code;
    this.status = status;
  }
}

function env(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function authConfiguredFromEnv(): boolean {
  const authDisabled = env("VITE_AUTH_ENABLED") === "false";
  const googleDirect = Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));
  const grokClientId = env("GROK_AUTH_CLIENT_ID") ?? "grok_preview";
  const grokBrokerConfigured =
    !authDisabled && !googleDirect && Boolean(grokClientId && env("GROK_AUTH_CLIENT_SECRET"));
  return !authDisabled && (googleDirect || grokBrokerConfigured);
}

/** True when anonymous callers must not reach server-managed provider keys. */
export function synthesisAuthRequired(): boolean {
  if (authConfiguredFromEnv() || gateIdentityEnabled()) return true;
  if (Boolean(env("DATABASE_URL"))) return true;
  if (env("SYNTHESIS_REQUIRE_AUTH") === "true") return true;
  if (process.env.NODE_ENV === "production") return true;
  return false;
}

/** Explicit dev/test bypass for harnesses — never on by default in production. */
export function synthesisDevBypassAllowed(): boolean {
  if (env("SYNTHESIS_DEV_BYPASS") === "true") return true;
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.VITEST === "true") return true;
  return false;
}

function databaseConfigured(): boolean {
  return Boolean(env("DATABASE_URL"));
}

/**
 * Require a verified user id before synthesis when auth is required.
 * Throws with message `Unauthorized` (401) when missing.
 */
export function requireSynthesisUserId(userId: string | undefined): string {
  if (!synthesisAuthRequired()) {
    if (databaseConfigured() && !synthesisDevBypassAllowed()) {
      throw new SynthesisGuardError(
        "unauthorized",
        "Synthesis requires authentication when DATABASE_URL is set",
        401,
      );
    }
    return userId ?? "dev-user";
  }
  if (!userId) {
    throw new SynthesisGuardError("unauthorized", "Unauthorized", 401);
  }
  return userId;
}

/** Estimate evidence payload embedded in a synthesis prompt. */
export function estimateEvidenceChars(prompt: string): number {
  const blocks = prompt.match(/---[\s\S]*?---/g) ?? [];
  if (blocks.length === 0) return 0;
  return blocks.reduce((sum, block) => sum + block.length, 0);
}

function clientKeysByteLength(keys?: ProviderKeys): number {
  if (!keys) return 0;
  let total = 0;
  for (const value of Object.values(keys)) {
    if (typeof value === "string") total += value.length;
  }
  return total;
}

export function validateSynthesisPayload(
  data: SynthesisDirectInput,
  serializedBodyLength?: number,
): void {
  const prompt = data.prompt ?? "";
  const query = data.query ?? "";
  if (prompt.length > SYNTHESIS_LIMITS.maxPromptChars) {
    throw new SynthesisGuardError("prompt_too_large", "Prompt exceeds the maximum allowed size");
  }
  if (query.length > SYNTHESIS_LIMITS.maxQueryChars) {
    throw new SynthesisGuardError("query_too_large", "Query exceeds the maximum allowed size");
  }
  const evidenceChars = estimateEvidenceChars(prompt);
  if (evidenceChars > SYNTHESIS_LIMITS.maxEvidenceChars) {
    throw new SynthesisGuardError("evidence_too_large", "Evidence exceeds the maximum allowed size");
  }
  const bodyLen =
    serializedBodyLength ??
    prompt.length + query.length + clientKeysByteLength(data.keys) + (data.modelId?.length ?? 0);
  if (bodyLen > SYNTHESIS_LIMITS.maxRequestBodyChars) {
    throw new SynthesisGuardError("body_too_large", "Request body exceeds the maximum allowed size");
  }
  if (clientKeysByteLength(data.keys) > SYNTHESIS_LIMITS.maxClientKeyChars) {
    throw new SynthesisGuardError("body_too_large", "Provider keys exceed the maximum allowed size");
  }
}

/** Strip provider keys from payloads before logging. */
export function redactSynthesisForLog(data: SynthesisDirectInput): Record<string, unknown> {
  return {
    queryLen: data.query?.length ?? 0,
    promptLen: data.prompt?.length ?? 0,
    modelId: data.modelId,
    policy: data.policy,
    hasKeys: Boolean(data.keys && Object.values(data.keys).some((k) => typeof k === "string" && k.trim())),
  };
}
