/**
 * Reads what was dropped on the upload area. A dropped folder arrives in
 * `dataTransfer.files` as one empty, typeless entry, which no reader can use,
 * so folders are walked through the entry API and their files come back with
 * the same `webkitRelativePath` a folder chooser would give them.
 */

import { GROUPED_DROP_ROOT, markGroupedDropFile, shouldSkipDirectory, SKIP_LABEL, type SkippedFile } from "./folder.ts";

type DropFileEntry = {
  isFile: true;
  isDirectory: false;
  name: string;
  fullPath: string;
  file: (ok: (file: File) => void, fail?: (error: unknown) => void) => void;
};

type DropDirectoryEntry = {
  isFile: false;
  isDirectory: true;
  name: string;
  fullPath: string;
  createReader: () => {
    readEntries: (ok: (entries: DropEntry[]) => void, fail?: (error: unknown) => void) => void;
  };
};

export type DropEntry = DropFileEntry | DropDirectoryEntry;

type DropItem = {
  kind: string;
  // Typed loosely so a DOM DataTransferItem fits; its FileSystemEntry is
  // narrowed to DropEntry by the isFile / isDirectory flags below.
  getAsEntry?: () => unknown;
  webkitGetAsEntry?: () => unknown;
  getAsFile?: () => File | null;
};

export type DropSource = { items?: ArrayLike<DropItem> | null; files?: ArrayLike<File> | null };

export type DroppedMaterial = {
  /** True when at least one dropped item was a folder. */
  folder: boolean;
  files: File[];
  capped: boolean;
  skipLabels: string[];
  /** Folders that were not opened and files that could not be read, with reasons. */
  skippedFiles: SkippedFile[];
};

const MAX_WALKED_FILES = 20_000;

function withRelativePath(file: File, relative: string): File {
  try {
    Object.defineProperty(file, "webkitRelativePath", { value: relative, configurable: true });
    return file;
  } catch {
    const copy = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
    Object.defineProperty(copy, "webkitRelativePath", { value: relative, configurable: true });
    return copy;
  }
}

function tryRead<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function safeCallback<T>(call: (ok: (value: T) => void, fail: () => void) => void): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      call(resolve, () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

function entryOf(item: DropItem): DropEntry | undefined {
  for (const method of ["getAsEntry", "webkitGetAsEntry"] as const) {
    const entry = tryRead(() => item[method]?.()) as DropEntry | undefined;
    if (entry?.isDirectory || entry?.isFile) return entry;
  }
  return undefined;
}

/**
 * Entries must be taken from the event before any await, because the browser
 * empties the DataTransfer once the drop handler returns. Call this directly
 * in the handler and await the result afterwards.
 */
export async function readDrop(source: DropSource): Promise<DroppedMaterial> {
  const files: File[] = [];
  const skipLabels = new Set<string>();
  const skippedFiles: SkippedFile[] = [];
  let folder = false;
  let capped = false;

  try {
    const entries: DropEntry[] = [];
    const loose: File[] = [];
    const items = tryRead(() => Array.from(source.items ?? [])) ?? [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      const entry = entryOf(item);
      if (entry) entries.push(entry);
      else {
        const file = tryRead(() => item.getAsFile?.());
        if (file) loose.push(file);
      }
    }
    if (entries.length === 0 && loose.length === 0) {
      return { folder, files: tryRead(() => Array.from(source.files ?? [])) ?? [], capped, skipLabels: [], skippedFiles };
    }
    folder = entries.some((entry) => entry.isDirectory);
    const grouped = folder && entries.length + loose.length > 1;
    const rootNames = new Set<string>();
    let walked = 0;

    function addFile(file: File, relative = "") {
      const picked = relative ? withRelativePath(file, relative) : file;
      if (grouped) markGroupedDropFile(picked);
      files.push(picked);
    }

    async function walk(entry: DropEntry, rootPrefix = "", pathWithinRoot = ""): Promise<void> {
      if (entry.isFile) {
        if (folder && walked >= MAX_WALKED_FILES) {
          capped = true;
          return;
        }
        walked += 1;
        const file = await safeCallback<File>((ok, fail) => entry.file(ok, fail));
        if (!file) {
          skipLabels.add(SKIP_LABEL.failed);
          skippedFiles.push({ path: pathWithinRoot || entry.name, reason: SKIP_LABEL.failed });
          return;
        }
        const path = rootPrefix ? `${rootPrefix}/${pathWithinRoot}` : grouped ? `${GROUPED_DROP_ROOT}/${file.name}` : "";
        addFile(file, path);
        return;
      }
      if (pathWithinRoot && shouldSkipDirectory(pathWithinRoot)) {
        skipLabels.add(SKIP_LABEL.vendor);
        // Not opened, so how many files it holds is not known here.
        skippedFiles.push({ path: `${pathWithinRoot}/`, reason: SKIP_LABEL.vendor });
        return;
      }
      const reader = tryRead(() => entry.createReader());
      if (!reader) {
        skipLabels.add(SKIP_LABEL.failed);
        skippedFiles.push({ path: `${pathWithinRoot || entry.name}/`, reason: SKIP_LABEL.failed });
        return;
      }
      // Reading one batch at a time prevents a huge directory from having to
      // accumulate every entry in memory before the walker can apply the cap.
      while (!capped) {
        const batch = await safeCallback<DropEntry[]>((ok, fail) => reader.readEntries(ok, fail));
        if (!batch) {
          skipLabels.add(SKIP_LABEL.failed);
          skippedFiles.push({ path: `${pathWithinRoot || entry.name}/`, reason: SKIP_LABEL.failed });
          return;
        }
        if (batch.length === 0) return;
        for (const child of batch) {
          const path = pathWithinRoot ? `${pathWithinRoot}/${child.name}` : child.name;
          await walk(child, rootPrefix, path);
          if (capped) return;
        }
      }
    }

    for (const file of loose) addFile(file, grouped ? `${GROUPED_DROP_ROOT}/${file.name}` : "");
    walked = loose.length;
    for (const entry of entries) {
      if (capped) break;
      if (entry.isDirectory) {
        let name = entry.name;
        for (let suffix = 2; rootNames.has(name); suffix += 1) name = `${entry.name} (${suffix})`;
        rootNames.add(name);
        await walk(entry, grouped ? `${GROUPED_DROP_ROOT}/${name}` : name);
      } else {
        await walk(entry);
      }
    }
  } catch {
    // The drop event is best effort. Keep any files gathered before an
    // unexpected browser error and show that part of the selection was unreadable.
    skipLabels.add(SKIP_LABEL.failed);
  }
  if (capped) {
    // The walk stopped, so what was left has no names. It is still listed:
    // nothing the person dropped goes missing without a line saying so.
    skipLabels.add(SKIP_LABEL.walk);
    skippedFiles.push({ path: `everything after the first ${MAX_WALKED_FILES.toLocaleString("en-US")} files`, reason: SKIP_LABEL.walk });
  }
  return { folder, files, capped, skipLabels: [...skipLabels], skippedFiles };
}
