import { documentIsCurrent, type DocumentEvidence } from "../../search/evidence.ts";
import type { NormalizedDocument } from "../types.ts";
import type { ViewerAvailability } from "./types.ts";

export const STALE_SOURCE_COPY = "Source evidence is no longer available for this version.";

export function viewerAvailability(args: {
  blob: Blob | null;
  evidence: DocumentEvidence | null;
  document: NormalizedDocument | undefined;
  requestedHash: string;
}): ViewerAvailability {
  if (!args.evidence) return "missing";
  if (!args.blob) return "stale";
  if (args.evidence.contentHash !== args.requestedHash) return "stale";
  if (!documentIsCurrent(args.evidence, args.document)) return "stale";
  return "ready";
}
