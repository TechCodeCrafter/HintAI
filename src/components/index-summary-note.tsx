import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { indexStatusView, namedFailures } from "@/lib/context/index-status";
import { groupSkipped, splitSkipped, summarizeLoaded } from "@/lib/context/index-summary";
import type { SkippedFile } from "@/lib/repo/folder";
import { useMeetHint } from "@/lib/store";

/** How many paths one reason lists before the rest are counted, not named. */
const SKIPPED_PATHS_SHOWN = 40;
const NONE: SkippedFile[] = [];

function total(groups: { count: number }[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

function files(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "file" : "files"}`;
}

function SkippedGroups({ groups, testId }: { groups: ReturnType<typeof groupSkipped>; testId: string }) {
  return (
    <ul className="index-status-groups" data-testid={testId}>
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
  );
}

/**
 * Where the index stands, in one line that follows the load:
 * "Reading 120 of 480 files…", "Indexing 120 of 480 files, 1,930 chunks so
 * far…", then "Indexed 480 files, 2,104 chunks. Ready."
 *
 * While a load runs the numbers come from the step doing the work (the file
 * reader, then the indexer). Once it is finished they are counted from the
 * chunks search runs over, so they follow a re-index or a toggled exclusion
 * with no state of their own to go stale.
 *
 * Files that failed to parse are named apart from files skipped by a rule.
 * A file that could not be read at all is never stored, so it is known only
 * for the selection just loaded and is not kept after the page reloads. A PDF
 * that could not be read is stored, and stays listed.
 */
export function IndexSummaryNote({
  className,
  working: callerWorking = false,
  bar = true,
}: {
  className?: string;
  /** The caller is still working on this load (a second step has not started yet). */
  working?: boolean;
  /** False where the screen already draws its own progress bar. */
  bar?: boolean;
}) {
  const sources = useMeetHint((s) => s.sources);
  const pack = useMeetHint((s) => s.pack);
  const chunks = useMeetHint((s) => s.chunks);
  const contextStatus = useMeetHint((s) => s.contextStatus);
  const loadingFolder = useMeetHint((s) => s.loadingFolder);
  const contextUpdating = useMeetHint((s) => s.contextUpdating);
  const activity = useMeetHint((s) => s.indexActivity);
  const ingest = useMeetHint((s) => s.ingestProgress);
  const notLoaded = useMeetHint((s) =>
    s.loadSkipped && s.loadSkipped.spaceId === s.activeSpaceId ? s.loadSkipped.files : NONE,
  );

  const booting = contextStatus === "booting";
  const pdfWorking = Boolean(ingest && ingest.phase !== "ready");
  const working =
    callerWorking || booting || contextStatus === "hydrating" || loadingFolder || contextUpdating || pdfWorking;

  const summary = useMemo(() => summarizeLoaded(sources, pack, chunks), [sources, pack, chunks]);
  const view = indexStatusView({
    working,
    booting,
    errored: contextStatus === "error",
    activity,
    pdf: ingest,
    summary,
  });
  const { failed, left } = useMemo(
    () => splitSkipped([...notLoaded, ...summary.skipped]),
    [notLoaded, summary],
  );
  const failedGroups = useMemo(() => groupSkipped(failed), [failed]);
  const leftGroups = useMemo(() => groupSkipped(left), [left]);
  const failedCount = total(failedGroups);
  const leftCount = total(leftGroups);
  // While a load runs, a file that has not been reached yet has no chunks
  // either. Only a finished pass can say which files failed.
  const settled = view.state !== "working";

  return (
    <div className={cn("index-status", className)} data-testid="index-status" data-state={view.state}>
      {/* aria-busy holds the announcement until the load ends, so a screen
          reader hears the result once and not every count on the way. */}
      <p className="index-status-line" role="status" aria-busy={!settled} data-testid="index-summary">
        {view.state === "ready" ? <span className="index-status-dot" aria-hidden="true" /> : null}
        <span className="tabular-nums">{view.text}</span>
      </p>
      {!settled && bar ? (
        <div
          className="index-status-bar"
          role="progressbar"
          aria-label="Indexing progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.fraction === null ? undefined : Math.round(view.fraction * 100)}
          aria-valuetext={view.text}
          data-indeterminate={view.fraction === null ? "true" : undefined}
        >
          <span style={view.fraction === null ? undefined : { transform: `scaleX(${view.fraction})` }} />
        </div>
      ) : null}
      {settled && failedCount > 0 ? (
        <details className="index-status-more" data-testid="index-failed">
          <summary className="index-status-failed">
            {files(failedCount)} failed to parse: {namedFailures(failed.map((item) => item.path))}
          </summary>
          <SkippedGroups groups={failedGroups} testId="index-failed-list" />
        </details>
      ) : null}
      {settled && leftCount > 0 ? (
        <details className="index-status-more" data-testid="index-skipped-details">
          <summary className="index-status-left">{files(leftCount)} skipped</summary>
          <SkippedGroups groups={leftGroups} testId="index-skipped" />
        </details>
      ) : null}
    </div>
  );
}
