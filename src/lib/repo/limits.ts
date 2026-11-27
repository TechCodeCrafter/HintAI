/**
 * How much one folder selection may load.
 *
 * The limits are per selection, not per space: adding a second folder to a
 * space starts a new count. They bound how much text is read into the tab in
 * one go; a file over them is not dropped quietly, it is listed with the
 * limit it ran into (`fileCapLabel`, `totalCapLabel`).
 *
 * Defaults can be changed for a deployment with `VITE_FOLDER_MAX_FILES` and
 * `VITE_FOLDER_MAX_MB`. They cannot be set below the floor: the old limits
 * (500 files, 8 MB) left out most of a real repository.
 */
export type FolderLimits = {
  /** Files one selection may load. */
  maxFiles: number;
  /** Bytes of files one selection may load, counted on disk. */
  maxTotalBytes: number;
};

const MB = 1024 * 1024;

/**
 * Set by measurement (`e2e/large-repo-bench.spec.ts`). A folder at both
 * limits (5,000 files, 50 MB, 52,000 chunks) is Ready in about half a minute
 * and answers a question in under 400 ms. Twice the bytes does not, so the
 * size limit stops here.
 */
export const DEFAULT_FOLDER_LIMITS: FolderLimits = {
  maxFiles: 5000,
  maxTotalBytes: 50 * MB,
};

/** The least a deployment may configure. */
export const FOLDER_LIMIT_FLOOR: FolderLimits = {
  maxFiles: 2000,
  maxTotalBytes: 50 * MB,
};

function envNumber(name: string): number | null {
  let raw: unknown;
  try {
    raw = (import.meta as { env?: Record<string, unknown> }).env?.[name];
  } catch {
    /* node --test has no Vite env */
  }
  if (raw === undefined && typeof process !== "undefined") raw = process.env?.[name];
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

let override: Partial<FolderLimits> | null = null;

/**
 * Replaces the limits for this tab. For tests, which need a folder over the
 * limit without writing thousands of files. Not bound by the floor.
 */
export function setFolderLimitsForTests(next: Partial<FolderLimits> | null): void {
  override = next;
}

/**
 * Limits a browser test set on `window.__folderLimits`. Read only in a build
 * made for those tests (`VITE_E2E=true`), so a page cannot change them.
 */
function browserTestOverride(): Partial<FolderLimits> | null {
  if (typeof window === "undefined") return null;
  let e2e = false;
  try {
    e2e = (import.meta as { env?: Record<string, unknown> }).env?.VITE_E2E === "true";
  } catch {
    /* node --test has no Vite env */
  }
  if (!e2e) return null;
  return (window as { __folderLimits?: Partial<FolderLimits> }).__folderLimits ?? null;
}

/** The limits in force: the defaults, then the deployment's settings, then a test's. */
export function folderLimits(): FolderLimits {
  const files = envNumber("VITE_FOLDER_MAX_FILES");
  const megabytes = envNumber("VITE_FOLDER_MAX_MB");
  const configured: FolderLimits = {
    maxFiles: files === null ? DEFAULT_FOLDER_LIMITS.maxFiles : Math.max(FOLDER_LIMIT_FLOOR.maxFiles, Math.floor(files)),
    maxTotalBytes:
      megabytes === null
        ? DEFAULT_FOLDER_LIMITS.maxTotalBytes
        : Math.max(FOLDER_LIMIT_FLOOR.maxTotalBytes, Math.floor(megabytes * MB)),
  };
  return { ...configured, ...(browserTestOverride() ?? {}), ...(override ?? {}) };
}

/** "5,000" */
function whole(value: number): string {
  return value.toLocaleString("en-US");
}

/** "50 MB", "1.5 MB", "300 KB" */
export function formatBytes(bytes: number): string {
  if (bytes >= MB) {
    const value = bytes / MB;
    return `${Number.isInteger(value) ? whole(value) : value.toFixed(1)} MB`;
  }
  return `${whole(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** The reason a file past the file limit is listed with. */
export function fileCapLabel(limits: FolderLimits = folderLimits()): string {
  return `over the ${whole(limits.maxFiles)}-file limit`;
}

/** The reason a file that would take the selection past the size limit is listed with. */
export function totalCapLabel(limits: FolderLimits = folderLimits()): string {
  return `over the ${formatBytes(limits.maxTotalBytes)} total size limit`;
}

/** True for a reason written by either limit, at any setting and in the older wording. */
export function isLimitReason(reason: string): boolean {
  return /^over the [\d,.]+(-file (cap|limit)| (MB|KB) total size limit)$/.test(reason) || reason === "over the total size limit";
}
