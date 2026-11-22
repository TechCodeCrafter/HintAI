import { useMemo } from "react";
import { summarizeLoaded } from "@/lib/context/index-summary";
import { useMeetHint } from "@/lib/store";

/** Files with at least one searchable chunk. Stored files that produced none are not counted. */
export function useIndexedFileCount(): number {
  const sources = useMeetHint((s) => s.sources);
  const pack = useMeetHint((s) => s.pack);
  const chunks = useMeetHint((s) => s.chunks);
  return useMemo(() => summarizeLoaded(sources, pack, chunks).filesIndexed, [sources, pack, chunks]);
}
