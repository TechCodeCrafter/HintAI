import type { SpaceMaterialView } from "../context/material-view.ts";
import { fileInMaterial } from "../context/material-view.ts";
import type { FileHit, IndexedChunk, RepoPack } from "../repo/types.ts";
import { isFileHit } from "../repo/types.ts";
import { textEvidence, verifyClaim, type Evidence } from "../search/evidence.ts";
import { retrieve } from "../search/retrieve.ts";

export type ClaimAdmit = {
  status: "supported" | "unverified";
  evidence: Evidence[] | null;
};

function evidenceFromHit(hit: FileHit, pack: RepoPack, material?: SpaceMaterialView): Evidence | null {
  const materialFile = material ? fileInMaterial(material, hit.path, hit.sourceId) : undefined;
  const packFile = pack.files.find((item) => item.path === hit.path);
  const file = materialFile ?? packFile;
  if (!file) return null;
  const fromOffset = file.content.slice(hit.startOffset, hit.startOffset + hit.text.length);
  const start = fromOffset === hit.text ? hit.startOffset : file.content.indexOf(hit.text);
  if (start < 0) return null;
  return textEvidence({
    path: hit.path,
    content: file.content,
    start,
    end: start + hit.text.length,
    normalizedText: hit.text,
    sourceId: hit.sourceId ?? materialFile?.sourceId,
  });
}

/**
 * Score a line that was already said. Retrieve, then verifyClaim on that line.
 * Does not compose a new sentence and does not call localCard.
 */
function spanSize(evidence: Evidence): number {
  if (evidence.kind === "text") return evidence.endOffset - evidence.startOffset;
  if (evidence.kind === "document") return evidence.supportText.length;
  return evidence.text.length;
}

export function claimAdmit(
  utterance: string,
  pack: RepoPack,
  chunks: IndexedChunk[],
  material?: SpaceMaterialView,
): ClaimAdmit {
  const hits = retrieve(utterance, chunks).filter(isFileHit);
  const supported: Evidence[] = [];
  for (const hit of hits) {
    const evidence = evidenceFromHit(hit, pack, material);
    if (!evidence) continue;
    const check = verifyClaim(utterance, [evidence]);
    if (check.ok && check.checked > 0) supported.push(evidence);
  }
  if (supported.length === 0) return { status: "unverified", evidence: null };
  supported.sort((a, b) => spanSize(a) - spanSize(b));
  return { status: "supported", evidence: [supported[0]!] };
}
