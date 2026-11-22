import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { formatIndexSummary, groupSkipped, summarizeLoaded } from "@/lib/context/index-summary";
import type { SkippedFile } from "@/lib/repo/folder";
import { useMeetHint } from "@/lib/store";

/** How many paths one reason lists before the rest are counted, not named. */
const SKIPPED_PATHS_SHOWN = 40;
const NONE: SkippedFile[] = [];

/**
 * "Indexed X files, Y chunks", counted from the chunks search runs over, and
 * every file that is not among them with the reason it was left out.
 *
 * The counts are recomputed from the store on every change, so they follow a
 * re-index or a toggled exclusion. Files that were never stored (too large,
 * unsupported, over the cap) are known only for the selection just loaded;
 * they are not kept after the page reloads.
 */
export function IndexSummaryNote({ className }: { className?: string }) {
  const sources = useMeetHint((s) => s.sources);
  const pack = useMeetHint((s) => s.pack);
  const chunks = useMeetHint((s) => s.chunks);
  const notLoaded = useMeetHint((s) =>
    s.loadSkipped && s.loadSkipped.spaceId === s.activeSpaceId ? s.loadSkipped.files : NONE,
  );
  const summary = useMemo(() => summarizeLoaded(sources, pack, chunks), [sources, pack, chunks]);
  const groups = useMemo(() => groupSkipped([...notLoaded, ...summary.skipped]), [notLoaded, summary]);
  const left = groups.reduce((sum, group) => sum + group.count, 0);
  const line = formatIndexSummary(summary);

  if (left === 0) {
    return (
      <p className={cn("text-xs tabular-nums text-muted", className)} data-testid="index-summary">
        {line}
      </p>
    );
  }
  return (
    <details className={cn("text-xs text-muted", className)} data-testid="index-summary">
      <summary className="cursor-pointer tabular-nums hover:text-fg">
        {line} {left.toLocaleString("en-US")} not indexed.
      </summary>
      <ul className="mt-2 max-h-56 space-y-2 overflow-auto text-left" data-testid="index-skipped">
        {groups.map((group) => (
          <li key={group.reason}>
            <p className="text-body">
              {group.count.toLocaleString("en-US")} × {group.reason}
            </p>
            <ul className="mt-0.5 space-y-0.5 font-mono text-[11px]">
              {group.files.slice(0, SKIPPED_PATHS_SHOWN).map((item) => (
                <li key={item.path} className="truncate" title={item.path}>
                  {item.path}
                  {item.count ? ` (${item.count.toLocaleString("en-US")} files)` : ""}
                </li>
              ))}
              {group.files.length > SKIPPED_PATHS_SHOWN ? (
                <li>and {(group.files.length - SKIPPED_PATHS_SHOWN).toLocaleString("en-US")} more</li>
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}
