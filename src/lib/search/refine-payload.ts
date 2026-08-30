import type { Card, FileHit, Hit } from "@/lib/repo/types";
import { isFileHit } from "../repo/types.ts";

/**
 * Hits that may leave the browser for optional xAI refine.
 * Document chunks never enter this payload.
 */
export function hitsForRefine(hits: Hit[]): FileHit[] {
  return hits.filter(isFileHit);
}

export function refinePayload(hits: Hit[]) {
  return hitsForRefine(hits).map((hit) => ({
    kind: hit.kind,
    path: hit.path,
    startLine: hit.startLine,
    text: hit.text,
    sha: hit.sha,
    pr: hit.pr,
    author: hit.author,
    message: hit.message,
  }));
}

export function shouldRefine(hits: Hit[], card?: Card): boolean {
  if (card?.evidence?.some((item) => item.kind === "document")) return false;
  if (hits.length === 0) return false;
  if (hits[0]?.kind === "document") return false;
  if (hits.every((hit) => hit.kind === "document")) return false;
  return hitsForRefine(hits).length > 0;
}
