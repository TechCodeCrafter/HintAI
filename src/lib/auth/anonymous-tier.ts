/** Prefix for explicit anonymous workspaces when auth is on and no session exists. */
export const ANONYMOUS_WORKSPACE_PREFIX = "ws_anon_";

/** Stable browser-profile instance id (survives reload). */
const ANONYMOUS_INSTANCE_KEY = "meethint.anonymousInstance";

function authEnabled(): boolean {
  return import.meta.env.VITE_AUTH_ENABLED !== "false";
}

export class AnonymousTierError extends Error {
  readonly code = "anonymous-tier";

  constructor(message: string) {
    super(message);
    this.name = "AnonymousTierError";
  }
}

let tierReady = false;
let tierError: string | null = null;

export function isAnonymousWorkspaceId(id: string): boolean {
  return id.startsWith(ANONYMOUS_WORKSPACE_PREFIX);
}

export function isAuthenticatedWorkspaceId(id: string): boolean {
  return !isAnonymousWorkspaceId(id) && id !== "dev-user";
}

export function anonymousTierReady(): boolean {
  return tierReady;
}

export function anonymousTierError(): string | null {
  return tierError;
}

function randomInstanceSuffix(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

/** Stable per browser profile — uploads keyed to this id survive reload. */
export function getOrCreateAnonymousWorkspaceId(): string {
  if (typeof localStorage === "undefined") {
    throw new AnonymousTierError("Anonymous tier requires localStorage.");
  }
  try {
    const existing = localStorage.getItem(ANONYMOUS_INSTANCE_KEY)?.trim();
    if (existing) return `${ANONYMOUS_WORKSPACE_PREFIX}${existing}`;
    const suffix = randomInstanceSuffix();
    localStorage.setItem(ANONYMOUS_INSTANCE_KEY, suffix);
    return `${ANONYMOUS_WORKSPACE_PREFIX}${suffix}`;
  } catch {
    throw new AnonymousTierError("Anonymous tier could not persist its workspace id.");
  }
}

async function verifyIndexedDbWritable(dbName: string): Promise<void> {
  if (typeof indexedDB === "undefined") {
    throw new AnonymousTierError("IndexedDB is unavailable — cannot bind anonymous workspace.");
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(`__meethint_probe__${dbName}`, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("probe");
    };
    req.onsuccess = () => {
      req.result.close();
      indexedDB.deleteDatabase(`__meethint_probe__${dbName}`);
      resolve();
    };
    req.onerror = () => reject(new AnonymousTierError("IndexedDB open failed for anonymous workspace."));
    req.onblocked = () => reject(new AnonymousTierError("IndexedDB blocked for anonymous workspace."));
  });
}

/** Prove anonymous persistence works without binding a workspace yet. */
export async function probeAnonymousTier(): Promise<void> {
  const workspaceId = getOrCreateAnonymousWorkspaceId();
  const { contextDatabaseName } = await import("./account-boundary.ts");
  await verifyIndexedDbWritable(contextDatabaseName(workspaceId));
}

/**
 * Bind path for auth-on visitors without a session. Throws on failure — never
 * silently falls back to in-memory storage.
 */
export async function bindAnonymousWorkspace(): Promise<string> {
  const workspaceId = getOrCreateAnonymousWorkspaceId();
  const { contextDatabaseName, bindAccountId } = await import("./account-boundary.ts");
  await verifyIndexedDbWritable(contextDatabaseName(workspaceId));
  bindAccountId(workspaceId);
  return workspaceId;
}

/**
 * Startup bumper: when auth is enabled, the anonymous tier module must load and
 * prove IndexedDB is writable before the funnel runs.
 */
export async function ensureAnonymousTierReady(): Promise<void> {
  if (!authEnabled()) {
    tierReady = true;
    tierError = null;
    return;
  }
  try {
    await probeAnonymousTier();
    tierReady = true;
    tierError = null;
  } catch (err) {
    tierReady = false;
    tierError = err instanceof Error ? err.message : String(err);
    console.error("[anonymous-tier] FAILED TO LOAD:", tierError);
    throw err;
  }
}

/** Dev-only loud failure when auth is on but the anonymous tier did not initialize. */
export function reportAnonymousTierFailure(message: string): void {
  tierReady = false;
  tierError = message;
  console.error("[anonymous-tier] FAILED TO LOAD:", message);
}
