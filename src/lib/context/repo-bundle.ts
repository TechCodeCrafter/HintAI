import { hashContent } from "./hash.ts";
import {
  legacyRepoIdentity,
  prefixedPath,
  repoSourceIdentity,
  sanitizePathPrefix,
  type SourceIdentityFields,
} from "./source-identity.ts";
import { textSourceFromDraft } from "./source-write.ts";
import type { TextSourceDraft, TextStoredSource, StoredSource } from "./types.ts";
import { isPdfSource, isTextSource } from "./types.ts";

export type RepoBundleDraft = {
  displayName: string;
  /** When updating an existing repo bundle, pass its sourceId. */
  bundleSourceId?: string;
  pathPrefix?: string;
  files: TextSourceDraft[];
};

export type RepoBundleUpsertResult = {
  sources: StoredSource[];
  bundleSourceId: string;
  pathPrefix: string;
  identity: SourceIdentityFields;
  removedFileIds: string[];
  changed: boolean;
};

export function textSourcesInBundle(sources: StoredSource[], bundleSourceId: string): TextStoredSource[] {
  return sources.filter(
    (row): row is TextStoredSource => isTextSource(row) && row.sourceId === bundleSourceId,
  );
}

export async function upsertRepoBundle(
  contextId: string,
  bundle: RepoBundleDraft,
  existing: StoredSource[],
  now: number,
): Promise<RepoBundleUpsertResult> {
  const bundleSourceId = bundle.bundleSourceId ?? crypto.randomUUID();
  const pathPrefix = bundle.pathPrefix ?? sanitizePathPrefix(bundle.displayName);
  const identity = repoSourceIdentity(bundleSourceId, bundle.displayName, pathPrefix);
  const pdfs = existing.filter(isPdfSource);
  const otherBundles = existing.filter(
    (row) => isTextSource(row) && row.sourceId !== bundleSourceId,
  );
  const priorBundle = textSourcesInBundle(existing, bundleSourceId);
  const priorByPath = new Map(priorBundle.map((row) => [row.path, row]));

  const nextPaths = new Set<string>();
  const nextBundleFiles: TextStoredSource[] = [];
  const seen = new Set<string>();

  for (const draft of bundle.files) {
    const path = prefixedPath(pathPrefix, draft.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    nextPaths.add(path);
    const prior = priorByPath.get(path);
    const row = await textSourceFromDraft(
      contextId,
      { ...draft, path },
      prior,
      now,
      identity,
    );
    nextBundleFiles.push(row);
  }

  const removedFileIds = priorBundle.filter((row) => !nextPaths.has(row.path)).map((row) => row.id);
  const unchanged =
    removedFileIds.length === 0 &&
    nextBundleFiles.length === priorBundle.length &&
    nextBundleFiles.every((row) => {
      const prior = priorByPath.get(row.path);
      return prior && prior.contentHash === row.contentHash && prior.content === row.content;
    });

  const sources = [...pdfs, ...otherBundles, ...nextBundleFiles].sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  return {
    sources,
    bundleSourceId,
    pathPrefix,
    identity,
    removedFileIds,
    changed: !unchanged,
  };
}

export async function verifyRepoBundleFiles(
  stored: TextStoredSource[],
  expected: TextSourceDraft[],
  pathPrefix: string,
): Promise<boolean> {
  const byPath = new Map(stored.map((row) => [row.path, row]));
  if (byPath.size !== expected.length) return false;
  for (const draft of expected) {
    const path = prefixedPath(pathPrefix, draft.path);
    const row = byPath.get(path);
    if (!row) return false;
    const hash = await hashContent(draft.content);
    if (row.contentHash !== hash || row.content !== draft.content) return false;
  }
  return true;
}

export function bundleSourceIds(sources: StoredSource[]): string[] {
  const ids = new Set<string>();
  for (const row of sources) {
    if (isTextSource(row) && row.sourceId) ids.add(row.sourceId);
    if (isPdfSource(row) && row.sourceId) ids.add(row.sourceId);
  }
  return [...ids];
}

