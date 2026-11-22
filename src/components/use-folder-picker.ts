import { useMemo, useRef, useState } from "react";
import {
  previewScan,
  scanFileList,
  type FolderLoadOptions,
  type FolderPreview,
  type FolderScan,
  type SkippedFile,
} from "@/lib/repo/folder";
import { canPickDirectory, pickFolderScan } from "@/lib/repo/pick-folder";

export function useFolderPicker() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [includeTests, setIncludeTests] = useState(false);
  const [reading, setReading] = useState(false);
  // A dropped folder larger than one scan reads arrives incomplete.
  const [capped, setCapped] = useState(false);

  const preview = useMemo<FolderPreview | null>(
    () => (scan ? previewScan(scan, { includeTests }) : null),
    [scan, includeTests],
  );

  async function offerFolder() {
    if (canPickDirectory()) {
      setReading(true);
      let result;
      try {
        result = await pickFolderScan();
      } finally {
        setReading(false);
      }
      if (result.status === "cancelled") return;
      // An empty folder still opens the review dialog, which says why
      // nothing can be indexed instead of leaving the click unanswered.
      if (result.status === "picked") {
        setCapped(false);
        setScan(result.scan);
        return;
      }
    }
    // Safari, Firefox, embedded frames and refused pickers use the
    // webkitdirectory input that FolderPickerFields mounts.
    inputRef.current?.click();
  }

  function acceptList(
    list: FileList | File[] | null,
    detail?: { capped?: boolean; skipLabels?: string[]; skippedFiles?: SkippedFile[] },
  ) {
    if (!list) return;
    setScan(scanFileList(list, { skipLabels: detail?.skipLabels, skippedFiles: detail?.skippedFiles }));
    setCapped(Boolean(detail?.capped));
  }

  function cancelReview() {
    setScan(null);
    setCapped(false);
    setIncludeTests(false);
  }

  /**
   * What the person agreed to index. PDFs found in the folder go to the PDF
   * indexer, so they are handed back apart from the files and are not counted
   * among the files the folder reader is asked to account for.
   */
  function confirmFiles(): { files: File[]; pdfs: File[]; options: FolderLoadOptions } | null {
    if (!scan) return null;
    const files = scan.candidates.map((item) => item.file);
    const pdfs = [...scan.pdfs];
    // The reasons files were filtered out at review travel with the request,
    // so a result with nothing readable can still say what was in the folder.
    const options: FolderLoadOptions = {
      includeTests,
      selectedCount: scan.selected - pdfs.length,
      skipLabels: scan.skipLabels,
      skippedFiles: scan.skippedFiles,
    };
    cancelReview();
    return { files, pdfs, options };
  }

  return {
    inputRef,
    preview,
    includeTests,
    setIncludeTests,
    capped,
    reading,
    offerFolder,
    acceptList,
    cancelReview,
    confirmFiles,
  };
}

export type FolderPickerState = ReturnType<typeof useFolderPicker>;
