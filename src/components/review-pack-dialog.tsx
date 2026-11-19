import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import type { FolderPickerState } from "@/components/use-folder-picker";
import { useClientMounted } from "@/lib/use-client-mounted";
import { emptySelectionMessage, SKIP_LABEL, type FolderLoadOptions, type FolderPreview } from "@/lib/repo/folder";

export function ReviewPackDialog({
  preview,
  includeTests,
  capped = false,
  onIncludeTests,
  onCancel,
  onIndex,
}: {
  preview: FolderPreview | null;
  includeTests: boolean;
  /** The dropped folder was larger than one scan reads. */
  capped?: boolean;
  onIncludeTests: (value: boolean) => void;
  onCancel: () => void;
  onIndex: () => void;
}) {
  const titleId = useId();
  const mounted = useClientMounted();

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [preview, onCancel]);

  useEffect(() => {
    if (!preview) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [preview]);

  if (!preview || !mounted) return null;

  const empty = preview.keep === 0 && preview.pdfs === 0;
  // The choice is offered only when the folder holds tests to include.
  const hasTests = includeTests || preview.skipLabels.includes(SKIP_LABEL.tests);
  const counted = [
    preview.keep > 0 ? `${preview.keep.toLocaleString()} file${preview.keep === 1 ? "" : "s"}` : null,
    preview.pdfs > 0 ? `${preview.pdfs.toLocaleString()} PDF${preview.pdfs === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const summary = empty ? "0 files will be indexed" : `${counted.join(" and ")} will be indexed`;

  return createPortal(
    <div
      className="cockpit-modal fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 p-5 backdrop-blur-sm"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="relative z-[1] w-full max-w-lg rounded-[14px] border border-line bg-surface p-6 text-body shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="review-pack-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mh-eyebrow">Local folder</p>
        <h2 id={titleId} className="mh-display mt-2 text-3xl text-fg">
          Review your pack
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-body" data-testid="review-pack-summary">
          {summary}
          {preview.skipped > 0 ? `, ${preview.skipped.toLocaleString()} skipped` : ""}. Stays local.
        </p>
        {preview.keepSample.length > 0 ? (
          <p className="mt-2 text-xs text-muted">Keeping {preview.keepSample.join(", ")}</p>
        ) : null}
        {preview.skipLabels.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {preview.skipLabels.map((label) => (
              <span key={label} className="mh-chip">
                Skip {label}
              </span>
            ))}
          </div>
        ) : null}
        {preview.truncated ? (
          <p className="mt-4 text-sm text-warn">
            Some files are over this folder's size or file-count limit. For best results, load a
            service folder (src/) rather than the repo root.
          </p>
        ) : null}
        {capped ? (
          <p className="mt-4 text-sm text-warn" data-testid="review-pack-capped">
            That drop holds more files than one scan reads, so part of it is missing here. Drop
            a smaller folder, such as src/, to be sure everything is included.
          </p>
        ) : null}
        {empty ? (
          <p className="mt-4 text-sm text-warn">
            {emptySelectionMessage(preview)}
          </p>
        ) : null}
        {hasTests ? (
          <label className="mt-5 flex min-h-11 items-center gap-3 text-sm text-body">
            <input
              type="checkbox"
              className="size-4"
              checked={includeTests}
              data-testid="review-pack-include-tests"
              onChange={(event) => onIncludeTests(event.target.checked)}
            />
            Include tests
          </label>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="mh-cta"
            data-testid="review-pack-index"
            disabled={empty}
            onClick={onIndex}
          >
            Index
          </button>
          <button
            type="button"
            className="min-h-12 px-3 text-sm text-muted hover:text-fg"
            data-testid="review-pack-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function FolderPickerFields({
  picker,
  onIndex,
}: {
  picker: FolderPickerState;
  /** `files` is empty when the folder held only PDFs; `pdfs` go to the PDF indexer. */
  onIndex: (files: File[], options: FolderLoadOptions, pdfs: File[]) => void;
}) {
  return (
    <>
      <input
        ref={picker.inputRef}
        type="file"
        multiple
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        data-folder-input="true"
        data-testid="folder-input"
        suppressHydrationWarning
        onChange={(event) => {
          picker.acceptList(event.target.files);
          event.target.value = "";
        }}
        {...{ webkitdirectory: "", directory: "" }}
      />
      <ReviewPackDialog
        preview={picker.preview}
        includeTests={picker.includeTests}
        capped={picker.capped}
        onIncludeTests={picker.setIncludeTests}
        onCancel={picker.cancelReview}
        onIndex={() => {
          const next = picker.confirmFiles();
          if (!next) return;
          onIndex(next.files, next.options, next.pdfs);
        }}
      />
    </>
  );
}
