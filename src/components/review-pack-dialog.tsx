import { useEffect, useId } from "react";
import type { FolderLoadOptions, FolderPreview } from "@/lib/repo/folder";
import type { FolderPickerState } from "@/components/use-folder-picker";

export function ReviewPackDialog({
  preview,
  includeTests,
  onIncludeTests,
  onCancel,
  onIndex,
}: {
  preview: FolderPreview | null;
  includeTests: boolean;
  onIncludeTests: (value: boolean) => void;
  onCancel: () => void;
  onIndex: () => void;
}) {
  const titleId = useId();

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

  if (!preview) return null;

  const empty = preview.keep === 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/70 p-5 backdrop-blur-[2px]"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-[14px] border border-line bg-surface p-6 text-body shadow-lg"
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
          {preview.keep.toLocaleString()} file{preview.keep === 1 ? "" : "s"} will be indexed
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
            Capped at 500 files. For best results, load a service folder (src/) rather than the repo
            root.
          </p>
        ) : null}
        {empty ? (
          <p className="mt-4 text-sm text-warn">
            No readable source files in that selection. Pick source, markdown, text, or office files.
          </p>
        ) : null}
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
    </div>
  );
}

export function FolderPickerFields({
  picker,
  onIndex,
}: {
  picker: FolderPickerState;
  onIndex: (files: File[], options: FolderLoadOptions) => void;
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
        onIncludeTests={picker.setIncludeTests}
        onCancel={picker.cancelReview}
        onIndex={() => {
          const next = picker.confirmFiles();
          if (!next) return;
          onIndex(next.files, next.options);
        }}
      />
    </>
  );
}
