import { Ban, EyeOff, FileCode2, FileText } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { pathExcluded } from "@/lib/context/exclusions";
import type { PdfStoredSource } from "@/lib/context/types";
import { pdfSourceStatus } from "@/lib/document/pdf/source-status";
import type { RepoFile } from "@/lib/repo/types";
import { FILE_ROW_HEIGHT, rowWindow, WINDOW_FROM } from "@/lib/ui/row-window";

type Row = { kind: "file"; key: string; file: RepoFile } | { kind: "pdf"; key: string; source: PdfStoredSource };

function splitPath(path: string) {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return { name: path, dir: "" };
  return { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

/**
 * The files of a space, one row each, with the control that leaves a file
 * out of search.
 *
 * A repository has thousands of files, and this list sits beside the answer:
 * every answer opens the file it cites, which re-renders the list. So it is
 * memoized on what it shows, and past `WINDOW_FROM` rows it draws only the
 * rows on screen. Rows have one height, so the scroll bar is the same as if
 * every row were there.
 */
export const SourceFileList = memo(function SourceFileList({
  files,
  pdfs,
  excludePatterns,
  activePath,
  activePdfId,
  onOpenFile,
  onOpenPdf,
  onToggleExclusion,
}: {
  files: RepoFile[];
  pdfs: PdfStoredSource[];
  excludePatterns: string[];
  /** The text file open in the viewer, or null when a PDF is. */
  activePath: string | null;
  activePdfId: string | null;
  onOpenFile: (path: string) => void;
  onOpenPdf: (id: string) => void;
  onToggleExclusion: (path: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useMemo<Row[]>(
    () => [
      ...files.map((file): Row => ({ kind: "file", key: `f:${file.path}`, file })),
      ...pdfs.map((source): Row => ({ kind: "pdf", key: `p:${source.id}`, source })),
    ],
    [files, pdfs],
  );
  const windowed = rows.length > WINDOW_FROM;
  const [view, setView] = useState({ top: 0, height: 0 });

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !windowed) return;
    const read = () =>
      setView((current) =>
        current.top === list.scrollTop && current.height === list.clientHeight
          ? current
          : { top: list.scrollTop, height: list.clientHeight },
      );
    read();
    list.addEventListener("scroll", read, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", read);
      observer?.disconnect();
    };
  }, [windowed]);

  // Keep the open file's row on screen. In a windowed list that row may not
  // be drawn, so the scroll position is worked out from its place in the list.
  const activeIndex = useMemo(
    () =>
      rows.findIndex((row) =>
        row.kind === "file" ? activePdfId === null && row.file.path === activePath : row.source.id === activePdfId,
      ),
    [rows, activePath, activePdfId],
  );
  const activeKey = activeIndex >= 0 ? rows[activeIndex].key : null;
  useEffect(() => {
    const list = listRef.current;
    if (!list || activeKey === null) return;
    if (!windowed) {
      list.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
      return;
    }
    const top = activeIndex * FILE_ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + FILE_ROW_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + FILE_ROW_HEIGHT - list.clientHeight;
    }
    // `activeIndex` follows `activeKey`; a filter that moves the row is not a reason to scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, windowed]);

  const { start, end } = windowed ? rowWindow(view.top, view.height, rows.length) : { start: 0, end: rows.length };
  const rowStyle = windowed ? { height: FILE_ROW_HEIGHT, paddingBottom: 4 } : undefined;

  return (
    <ul
      ref={listRef}
      className={windowed ? "file-list min-h-0 min-w-0 flex-1 overflow-auto" : "file-list min-h-0 min-w-0 flex-1 space-y-1 overflow-auto"}
      data-testid="file-list"
      data-windowed={windowed ? "true" : undefined}
      data-row-count={rows.length}
      tabIndex={0}
    >
      {rows.length === 0 ? <li className="px-2 py-3 text-xs text-muted">No files match that filter.</li> : null}
      {windowed && start > 0 ? <li aria-hidden="true" style={{ height: start * FILE_ROW_HEIGHT }} /> : null}
      {rows.slice(start, end).map((row) => {
        if (row.kind === "file") {
          const path = row.file.path;
          const parts = splitPath(path);
          const excluded = pathExcluded(path, excludePatterns);
          return (
            <li key={row.key} className="file-item min-w-0" style={rowStyle}>
              <button
                type="button"
                data-source-kind="file"
                data-source-path={path}
                data-excluded={excluded ? "true" : undefined}
                data-active={activePdfId === null && path === activePath ? "true" : undefined}
                onClick={() => onOpenFile(path)}
                className="file-row flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left"
              >
                <FileCode2 className="size-3.5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="file-name block truncate text-[13px]">{parts.name}</span>
                  <span className="file-path block truncate">{excluded ? "Excluded from search" : parts.dir}</span>
                </span>
              </button>
              <button
                type="button"
                className="file-exclude"
                aria-pressed={excluded}
                aria-label={excluded ? `Include ${path} in search` : `Exclude ${path} from search`}
                title={excluded ? "Include in search" : "Exclude from search"}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExclusion(path);
                }}
              >
                {excluded ? <EyeOff className="size-3.5" /> : <Ban className="size-3.5" />}
              </button>
            </li>
          );
        }
        const source = row.source;
        const status = pdfSourceStatus(source);
        const parts = splitPath(source.path);
        const excluded = pathExcluded(source.path, excludePatterns);
        return (
          <li key={row.key} className="file-item min-w-0" style={rowStyle}>
            <button
              type="button"
              data-source-kind="pdf"
              data-source-path={source.path}
              data-source-status={source.readiness}
              data-excluded={excluded ? "true" : undefined}
              data-active={activePdfId === source.id ? "true" : undefined}
              title={status.detail}
              onClick={() => onOpenPdf(source.id)}
              className="file-row flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left"
            >
              <FileText className="size-3.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="file-name block truncate text-[13px]">{parts.name}</span>
                <span className="file-path block truncate" data-source-label>
                  {excluded
                    ? "Excluded from search"
                    : source.lastFailedNote && source.readiness === "ready"
                      ? "Update failed"
                      : status.short !== "Ready"
                        ? status.short
                        : parts.dir || "Ready"}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="file-exclude"
              aria-pressed={excluded}
              aria-label={excluded ? `Include ${source.path} in search` : `Exclude ${source.path} from search`}
              title={excluded ? "Include in search" : "Exclude from search"}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExclusion(source.path);
              }}
            >
              {excluded ? <EyeOff className="size-3.5" /> : <Ban className="size-3.5" />}
            </button>
          </li>
        );
      })}
      {windowed && end < rows.length ? (
        <li aria-hidden="true" style={{ height: (rows.length - end) * FILE_ROW_HEIGHT }} />
      ) : null}
    </ul>
  );
});
