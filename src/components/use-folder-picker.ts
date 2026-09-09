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
      try {
        const next = await pickFolderScan();
        if (next && next.selected > 0) setScan(next);
      } finally {
        setReading(false);
      }
      return;
    }
    inputRef.current?.click();
  }

  function acceptList(list: FileList | File[] | null) {
    if (!list || list.length === 0) return;
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
