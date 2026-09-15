import type { SpaceMaterialView } from "../context/material-view.ts";
import type { ContextRepository } from "../context/repository.ts";
import { isPdfSource, type StoredSource } from "../context/types.ts";
import type { NormalizedDocument } from "../document/types.ts";
import type { Hit } from "../repo/types.ts";
import { isDocumentHit } from "../repo/types.ts";
import type { LocalCardContext } from "./local-card.ts";

/**
 * Hydrate NormalizedDocument instances for PDF hits on the live answer hot path.
 * Loads only documents referenced by retrieval hits — never re-parses PDFs here.
 */
export async function hydratePdfDocumentsForHits(
  repo: ContextRepository,
  sources: StoredSource[],
  hits: Hit[],
  material: SpaceMaterialView,
): Promise<{ context: LocalCardContext; documentHydrateMs: number }> {
  const base: LocalCardContext = { material };
  const needed = new Set<string>();
  for (const hit of hits) {
    if (isDocumentHit(hit)) needed.add(hit.sourceId);
  }
  if (needed.size === 0) {
    return { context: base, documentHydrateMs: 0 };
  }

  const pdfByStableId = new Map<string, StoredSource>();
  for (const row of sources) {
    if (!isPdfSource(row)) continue;
    pdfByStableId.set(row.sourceId ?? row.id, row);
  }

  const t0 = performance.now();
  const documents: NormalizedDocument[] = [];
  const bySourceId = new Map<string, NormalizedDocument>();

  for (const sourceId of needed) {
    const source = pdfByStableId.get(sourceId);
    if (!source) continue;
    const document = await repo.getNormalizedDocument(source.id, source.contentHash);
    if (!document) continue;
    documents.push(document);
    bySourceId.set(sourceId, document);
  }

  return {
    context: {
      material,
      document: (id) => bySourceId.get(id),
      documents,
    },
    documentHydrateMs: Math.round(performance.now() - t0),
  };
}
