/**
 * Account-scoped local vault. Repos, indexes, and meeting history live in the
 * browser — they must be bound to a signed-in user, not just the origin.
 *
 * `dev-user` keeps the historic `meethint` database so local/e2e installs do
 * not migrate. Real accounts use `meethint.<id>`. Logout still deletes every
 * meethint vault on this origin so a shared browser profile cannot inspect
 * leftover copies.
 */
export const LOCAL_DEV_ACCOUNT_ID = "dev-user";
export const ACCOUNT_EPOCH_KEY = "meethint.accountEpoch";

export const SENSITIVE_LOCAL_KEYS = [
  "meethint.activeContextId",
  "ground.activeContextId",
  "ground.pack",
  "ground.pack.migrating",
  "meethint.session",
  "ground.session",
  "meethint.providerKeys",
  "meethint.modelId",
  "meethint.subscription",
  "meethint.extractQuota",
] as const;

const unbindHooks: Array<() => void> = [];

let boundAccountId: string | null = null;

export function currentAccountId(): string | null {
  return boundAccountId;
}

export function sanitizeAccountId(userId: string): string {
  const cleaned = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return cleaned || "account";
}

export function contextDatabaseName(accountId: string): string {
  if (accountId === LOCAL_DEV_ACCOUNT_ID) return "meethint";
  return `meethint.${sanitizeAccountId(accountId)}`;
}

export function vectorDatabaseName(accountId: string): string {
  if (accountId === LOCAL_DEV_ACCOUNT_ID) return "meethint-vectors";
  return `meethint-vectors.${sanitizeAccountId(accountId)}`;
}

export function onAccountUnbind(hook: () => void): void {
  unbindHooks.push(hook);
}

/** Point later reads at this account. Does not open IndexedDB. */
export function bindAccountId(accountId: string | null): boolean {
  if (boundAccountId === accountId) return false;
  boundAccountId = accountId;
  for (const hook of unbindHooks) hook();
  return true;
}

export function accountStorageKey(base: string): string | null {
  const id = boundAccountId;
  if (!id) return null;
  if (id === LOCAL_DEV_ACCOUNT_ID) return base;
  return `${base}.${sanitizeAccountId(id)}`;
}

export function readAccountStorage(base: string): string | null {
  const key = accountStorageKey(base);
  if (!key || typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeAccountStorage(base: string, value: string | null): void {
  const key = accountStorageKey(base);
  if (!key || typeof localStorage === "undefined") return;
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

function isSensitiveLocalKey(key: string): boolean {
  return SENSITIVE_LOCAL_KEYS.some((base) => key === base || key.startsWith(`${base}.`));
}

function isAccountDatabaseName(name: string): boolean {
  return (
    name === "meethint" ||
    name.startsWith("meethint.") ||
    name === "meethint-vectors" ||
    name.startsWith("meethint-vectors.")
  );
}

export function wipeSensitiveLocalStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const remove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && isSensitiveLocalKey(key)) remove.push(key);
    }
    for (const key of remove) localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

async function listedAccountDatabases(): Promise<string[]> {
  const names = new Set<string>(["meethint", "meethint-vectors"]);
  if (boundAccountId) {
    names.add(contextDatabaseName(boundAccountId));
    names.add(vectorDatabaseName(boundAccountId));
  }
  try {
    const listed = await indexedDB.databases();
    for (const db of listed) {
      if (db.name && isAccountDatabaseName(db.name)) names.add(db.name);
    }
  } catch {
    /* older browsers omit indexedDB.databases() */
  }
  return [...names];
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Remove every local repo vault and sensitive preference on this origin. */
export async function wipeBrowserAccountData(): Promise<void> {
  for (const hook of unbindHooks) hook();
  wipeSensitiveLocalStorage();
  if (typeof indexedDB === "undefined") return;
  const names = await listedAccountDatabases();
  await Promise.all(names.map((name) => deleteDatabase(name)));
}

export function publishAccountEpoch(accountId: string | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ACCOUNT_EPOCH_KEY, JSON.stringify({ accountId, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function readAccountEpoch(): { accountId: string | null; at: number } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACCOUNT_EPOCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { accountId?: string | null; at?: number };
    return { accountId: parsed.accountId ?? null, at: parsed.at ?? 0 };
  } catch {
    return null;
  }
}
