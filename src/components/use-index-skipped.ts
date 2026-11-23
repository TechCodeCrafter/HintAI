import { useMemo } from "react";
import { groupSkipped, splitSkipped, summarizeLoaded } from "@/lib/context/index-summary";
import type { SkippedFile } from "@/lib/repo/folder";
import { useMeetHint } from "@/lib/store";

const NONE: SkippedFile[] = [];

function total(groups: { count: number }[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

/**
 * The files search cannot reach right now, counted from the chunks it runs
 * over: stored files with no chunk, and files left out when the selection was
 * loaded. Files that failed to parse are kept apart from files skipped by a rule.
 *
 * `busy` is true while a load or re-index runs. A file that has not been
 * reached yet has no chunks either, so the lists are only final once it is false.
 */
export function useIndexSkipped() {
  const sources = useMeetHint((s) => s.sources);
  const pack = useMeetHint((s) => s.pack);
  const chunks = useMeetHint((s) => s.chunks);
  const notLoaded = useMeetHint((s) =>
    s.loadSkipped && s.loadSkipped.spaceId === s.activeSpaceId ? s.loadSkipped.files : NONE,
  );
  const busy = useMeetHint(
    (s) =>
      s.contextStatus !== "ready" ||
      s.loadingFolder ||
      s.contextUpdating ||
      Boolean(s.ingestProgress && s.ingestProgress.phase !== "ready"),
  );

  const summary = useMemo(() => summarizeLoaded(sources, pack, chunks), [sources, pack, chunks]);
  const { failed, left } = useMemo(
    () => splitSkipped([...notLoaded, ...summary.skipped]),
    [notLoaded, summary],
  );
  const failedGroups = useMemo(() => groupSkipped(failed), [failed]);
  const leftGroups = useMemo(() => groupSkipped(left), [left]);
  return {
    summary,
    failed,
    failedGroups,
    leftGroups,
    failedCount: total(failedGroups),
    leftCount: total(leftGroups),
    busy,
  };
}
