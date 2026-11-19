import { useMemo, useRef, useState } from "react";
import {
  previewScan,
  scanFileList,
  type FolderLoadOptions,
  type FolderPreview,
  type FolderScan,
} from "@/lib/repo/folder";
import { canPickDirectory, pickFolderScan } from "@/lib/repo/pick-folder";

export function useFolderPicker() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [includeTests, setIncludeTests] = useState(false);
  const [reading, setReading] = useState(false);

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
        setScan(result.scan);
        return;
      }
    }
    // Safari, Firefox, embedded frames and refused pickers use the
    // webkitdirectory input that FolderPickerFields mounts.
    inputRef.current?.click();
  }

  function acceptList(list: FileList | File[] | null) {
    if (!list) return;
    setScan(scanFileList(list));
  }

  function cancelReview() {
    setScan(null);
    setIncludeTests(false);
  }

  function confirmFiles(): { files: File[]; options: FolderLoadOptions } | null {
    if (!scan) return null;
    const files = scan.candidates.map((item) => item.file);
    const options: FolderLoadOptions = { includeTests, selectedCount: scan.selected };
    cancelReview();
    return { files, options };
  }

  return {
    inputRef,
    preview,
    includeTests,
    setIncludeTests,
    reading,
    offerFolder,
    acceptList,
    cancelReview,
    confirmFiles,
  };
}

export type FolderPickerState = ReturnType<typeof useFolderPicker>;
