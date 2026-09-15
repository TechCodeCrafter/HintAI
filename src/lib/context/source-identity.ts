import { defaultWorkspaceId } from "../auth/workspace.ts";
import { normalizePath } from "./storage/schema.ts";

export type SourceType = "repo" | "pdf" | "file";

/** Stable ingest-unit metadata shared by repo bundles and documents. */
export type SourceIdentityFields = {
  /** Stable ingest unit id (repo bundle or PDF). */
  sourceId: string;
  sourceType: SourceType;
  displayName: string;
  /** Namespace prefix for stored paths, e.g. `auth-service/`. Empty for legacy/PDF. */
  pathPrefix: string;
};

export type ChunkIdentityScope = {
  workspaceId: string;
  contextId: string;
  sourceId: string;
};

export type BuildChunksOptions = {
  structured?: boolean;
  chunkScope?: ChunkIdentityScope;
  sourceId?: string;
};

export function sanitizePathPrefix(displayName: string): string {
  const slug =
    displayName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repo";
  return `${slug}/`;
}

export function prefixedPath(pathPrefix: string, relativePath: string): string {
  const norm = normalizePath(relativePath);
  if (!pathPrefix) return norm;
  if (norm.startsWith(pathPrefix)) return norm;
  return `${pathPrefix}${norm}`;
}

export function displayNameFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "") || base;
}

export function pdfSourceIdentity(sourceId: string, path: string): SourceIdentityFields {
  return {
    sourceId,
    sourceType: "pdf",
    displayName: displayNameFromPath(path),
    pathPrefix: "",
  };
}

export function repoSourceIdentity(
  bundleSourceId: string,
  displayName: string,
  pathPrefix?: string,
): SourceIdentityFields {
  return {
    sourceId: bundleSourceId,
    sourceType: "repo",
    displayName,
    pathPrefix: pathPrefix ?? sanitizePathPrefix(displayName),
  };
}

/** Deterministic chunk id — unique across repos in the same knowledge container. */
export function fileChunkId(scope: ChunkIdentityScope, path: string, rangeKey: string): string {
  const workspaceId = scope.workspaceId || defaultWorkspaceId();
  return `${workspaceId}:${scope.contextId}:${scope.sourceId}:${normalizePath(path)}:${rangeKey}`;
}

export function vectorKeyFromChunkId(chunkId: string, scope?: Partial<ChunkIdentityScope>): string {
  if (scope?.workspaceId && scope.contextId) {
    return `${scope.workspaceId}:${scope.contextId}:${chunkId}`;
  }
  return chunkId;
}

export function withSourceIdentity<T extends SourceIdentityFields>(
  row: T,
  identity: SourceIdentityFields,
): T {
  return { ...row, ...identity };
}

export function isLegacyTextSource(row: { sourceId?: string; sourceType?: SourceType }): boolean {
  return row.sourceId == null || row.sourceType == null;
}

/** Migration: one bundle per legacy context for all text files. */
export function legacyRepoIdentity(contextId: string, contextName: string): SourceIdentityFields {
  return {
    sourceId: `legacy-${contextId}`,
    sourceType: "repo",
    displayName: contextName,
    pathPrefix: "",
  };
}
