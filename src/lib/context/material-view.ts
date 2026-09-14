import type { Citation, Hit, RepoPack } from "../repo/types.ts";
import { hashText } from "../search/evidence.ts";
import type { Evidence } from "../search/evidence.ts";
import type { FileCitation } from "../repo/types.ts";
import { isTextSource, type SourceType, type StoredSource } from "./types.ts";

/** One ingest unit in the active Knowledge Space — identity is never flattened away. */
export type MaterialSourceRef = {
  sourceId: string;
  sourceType: SourceType;
  displayName: string;
  contextId: string;
  pathPrefix: string;
  workspaceId: string;
};

/** A repo file with stable source coordinates for synthesis and citations. */
export type MaterialFile = {
  path: string;
  language: string;
  content: string;
  sourceId: string;
  contextId: string;
  displayName: string;
  contentHash: string;
};

/**
 * Aggregated material for one live question inside a Knowledge Space.
 * Paths may repeat across sources only when prefixed — never ambiguous path-only files.
 */
export type SpaceMaterialView = {
  workspaceId: string;
  spaceId: string;
  primaryContextId: string;
  memberContextIds: string[];
  sources: MaterialSourceRef[];
  /** Union pack for legacy callers; files use globally unique paths. */
  pack: RepoPack;
  filesByPath: Map<string, MaterialFile>;
  filesBySourceId: Map<string, MaterialFile[]>;
};

export type BuildMaterialViewInput = {
  workspaceId: string;
  spaceId: string;
  primaryContextId: string;
  memberContextIds: string[];
  pack: RepoPack;
  sources: StoredSource[];
};

function uniqueSources(sources: StoredSource[]): MaterialSourceRef[] {
  const seen = new Set<string>();
  const out: MaterialSourceRef[] = [];
  for (const row of sources) {
    if (seen.has(row.sourceId)) continue;
    seen.add(row.sourceId);
    out.push({
      sourceId: row.sourceId,
      sourceType: row.sourceType,
      displayName: row.displayName,
      contextId: row.contextId,
      pathPrefix: row.pathPrefix,
      workspaceId: row.workspaceId ?? "",
    });
  }
  return out;
}

function indexFiles(pack: RepoPack, sources: StoredSource[]): {
  filesByPath: Map<string, MaterialFile>;
  filesBySourceId: Map<string, MaterialFile[]>;
} {
  const textByPath = new Map(sources.filter(isTextSource).map((row) => [row.path, row]));
  const filesByPath = new Map<string, MaterialFile>();
  const filesBySourceId = new Map<string, MaterialFile[]>();

  for (const file of pack.files) {
    const row = textByPath.get(file.path);
    const material: MaterialFile = {
      path: file.path,
      language: file.language,
      content: file.content,
      sourceId: row?.sourceId ?? file.path,
      contextId: row?.contextId ?? "",
      displayName: row?.displayName ?? pack.name,
      contentHash: row?.contentHash ?? hashText(file.content),
    };
    filesByPath.set(file.path, material);
    const bucket = filesBySourceId.get(material.sourceId) ?? [];
    bucket.push(material);
    filesBySourceId.set(material.sourceId, bucket);
  }

  return { filesByPath, filesBySourceId };
}

/** Build the multi-source material view from indexed runtime state. */
export function buildSpaceMaterialView(input: BuildMaterialViewInput): SpaceMaterialView {
  const sources = uniqueSources(input.sources);
  const { filesByPath, filesBySourceId } = indexFiles(input.pack, input.sources);
  return {
    workspaceId: input.workspaceId,
    spaceId: input.spaceId,
    primaryContextId: input.primaryContextId,
    memberContextIds: [...input.memberContextIds],
    sources,
    pack: input.pack,
    filesByPath,
    filesBySourceId,
  };
}

export function fileInMaterial(
  view: SpaceMaterialView,
  path: string,
  sourceId?: string,
): MaterialFile | undefined {
  if (sourceId) {
    return view.filesBySourceId.get(sourceId)?.find((row) => row.path === path);
  }
  return view.filesByPath.get(path);
}

export function sourceRefInMaterial(view: SpaceMaterialView, sourceId: string): MaterialSourceRef | undefined {
  return view.sources.find((row) => row.sourceId === sourceId);
}

export function sourceLabel(view: SpaceMaterialView | undefined, sourceId?: string): string {
  if (!view || !sourceId) return "";
  return sourceRefInMaterial(view, sourceId)?.displayName ?? "";
}

/** Attach stable source coordinates to a file citation. */
export function enrichFileCitation(
  cite: FileCitation,
  view?: SpaceMaterialView,
  sourceId?: string,
): FileCitation {
  if (!view) {
    return sourceId ? { ...cite, sourceId } : cite;
  }
  const file = fileInMaterial(view, cite.path, sourceId ?? cite.sourceId);
  const ref = file ? sourceRefInMaterial(view, file.sourceId) : undefined;
  return {
    ...cite,
    sourceId: file?.sourceId ?? cite.sourceId ?? sourceId,
    sourceType: ref?.sourceType ?? cite.sourceType,
    displayName: ref?.displayName ?? file?.displayName ?? cite.displayName,
    contextId: file?.contextId ?? cite.contextId,
    contentHash: file?.contentHash ?? cite.contentHash,
  };
}

export function sourceIdsFromHits(hits: Hit[]): string[] {
  const ids = new Set<string>();
  for (const hit of hits) {
    if ("sourceId" in hit && hit.sourceId) ids.add(hit.sourceId);
  }
  return [...ids];
}

export function sourceIdsFromCitations(citations: Citation[]): string[] {
  const ids = new Set<string>();
  for (const cite of citations) {
    if ((cite.kind === "file" || cite.kind === "document") && cite.sourceId) {
      ids.add(cite.sourceId);
    }
  }
  return [...ids];
}

export function sourceIdsFromEvidence(evidence: Evidence[]): string[] {
  const ids = new Set<string>();
  for (const item of evidence) {
    if (item.kind === "text" || item.kind === "document" || item.kind === "commit") {
      if (item.sourceId) ids.add(item.sourceId);
    }
  }
  return [...ids];
}
