import { sourceBlobKey } from "../types.ts";
import type { Card } from "../../repo/types.ts";
import type { DocumentOpenTarget } from "./types.ts";

const pins = new Set<string>();

export function retainKeysFromCard(card: Card | null | undefined, open: DocumentOpenTarget | null | undefined): string[] {
  const keys = new Set<string>();
  if (open) keys.add(sourceBlobKey(open.sourceId, open.contentHash));
  for (const evidence of card?.evidence ?? []) {
    if (evidence.kind === "document") keys.add(sourceBlobKey(evidence.sourceId, evidence.contentHash));
  }
  return [...keys];
}

export function setViewerBlobPins(keys: Iterable<string>) {
  pins.clear();
  for (const key of keys) pins.add(key);
}

export function viewerPinnedBlobKeys(): Set<string> {
  return new Set(pins);
}

export function syncViewerBlobPins(card: Card | null | undefined, open: DocumentOpenTarget | null | undefined) {
  setViewerBlobPins(retainKeysFromCard(card, open));
}

/** Source keep-set plus Card/viewer pins so GC cannot drop live evidence. */
export function keepBlobHashes(sourceKeep: Iterable<string>): Set<string> {
  const next = new Set(sourceKeep);
  for (const key of pins) next.add(key);
  return next;
}
