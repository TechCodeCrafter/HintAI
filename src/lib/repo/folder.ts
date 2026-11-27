import {
  isOfficeExt,
  isOfficeLockName,
  officeReadError,
  parseCsvText,
  parseOfficeBuffer,
} from "../document/parsers/office-parsers.ts";
import { isPdfFile, MATERIAL_EXTENSIONS } from "../material-upload.ts";
import { gitFilesFromMap, readRecentChanges, type FileChange, type GitFiles } from "./git-history.ts";
import { fileCapLabel, folderLimits, formatBytes, totalCapLabel, type FolderLimits } from "./limits.ts";
import type { RepoFile, RepoPack } from "./types";

const SKIP_DIR =
  /(^|\/)(node_modules|\.git|\.next|\.nuxt|\.turbo|\.cache|\.venv|venv|\.deno|site-packages|dist-packages|lib\/python\d|__pypackages__|\.tox|env|virtualenv|dist|build|coverage|vendor|__pycache__|out|target|\.grok|\.idea|\.vscode|\.yarn|\.pnpm-store|Pods|\.gradle|storybook-static|playwright-report|cypress\/videos|generated|proto-gen|_scm_jenkins|_scm_|jenkins|\.github|\.circleci|\.gitlab)(\/|$)/i;

const SKIP_NAME =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|composer\.lock|\.DS_Store)(\/|$)/i;

/** Word `~$…` owner locks and LibreOffice `~lock.` stubs. */
function isOfficeLockPath(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return isOfficeLockName(base) || /^\.~lock\./i.test(base);
}

const SKIP_EXT =
  /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp4|mp3|wav|zip|gz|tgz|wasm|bin|exe|dmg|svg|avif)$/i;
const GENERATED_EXT = /\.(min\.js|map)$/i;

const ALLOW_EXT = new Set<string>(MATERIAL_EXTENSIONS);
const ALLOW_NAME = /^(README|LICENSE|LICENCE|COPYING|CHANGELOG|AUTHORS|CONTRIBUTING|NOTICE|Dockerfile|Containerfile|Makefile|Gemfile|Rakefile|Procfile)$/i;

/** The per-file limits. How many files and bytes one selection may load is in `limits.ts`. */
const MAX_FILE_BYTES = 150_000;
const OFFICE_MAX_FILE_BYTES = 4_000_000;
export const GROUPED_DROP_ROOT = "Dropped material";
const GROUPED_DROP_STORAGE_PREFIX = `${GROUPED_DROP_ROOT.toLowerCase().replaceAll(" ", "-")}/`;
const groupedDropFiles = new WeakSet<File>();

/** A shared virtual root preserves selected folder names without filtering them as descendants. */
export function markGroupedDropFile(file: File): void {
  groupedDropFiles.add(file);
}

export function shouldSkipDirectory(relativePath: string): boolean {
  return SKIP_DIR.test(relativePath);
}

/**
 * One file left out of the index, and why. `count` is set when the entry is a
 * folder that was not opened, and is the number of files inside it.
 */
export type SkippedFile = {
  path: string;
  reason: string;
  count?: number;
  /**
   * The file was meant to be indexed and could not be: it could not be read,
   * or it was stored and produced nothing to search. Unset for a file left
   * out on purpose (a vendor folder, a size limit, an exclusion).
   */
  failed?: boolean;
  /**
   * The folder the selection came from. Set only on the list kept with a
   * space, where two folders can both leave out a file with the same path.
   */
  root?: string;
};

export type FolderLoadOptions = {
  includeTests?: boolean;
  selectedCount?: number;
  skipLabels?: string[];
  /** Files an earlier step (folder review, drag and drop) already left out. */
  skippedFiles?: SkippedFile[];
  /** Called as each candidate file has been read or left out: how many so far, out of how many. */
  onRead?: (done: number, total: number) => void;
  /**
   * The folder's `.git`, as an earlier scan found it. The folder review hands
   * on only the files that will be indexed, so the history has to travel
   * beside them or it is lost before the load.
   */
  git?: GitFiles;
  /** The file and size limits for this load. Defaults to `folderLimits()`. */
  limits?: Partial<FolderLimits>;
  /**
   * Asked before each file is read. Once it returns true the load stops and
   * comes back with `cancelled` set; what it read so far must not be stored.
   */
  isCancelled?: () => boolean;
};

export type FolderCandidate = {
  file: File;
  path: string;
  score: number;
  pathForRules?: string;
};

export type FolderScan = {
  selected: number;
  folderName: string;
  candidates: FolderCandidate[];
  pdfs: File[];
  skipLabels: string[];
  failed: string[];
  /** Every file this scan left out, with the reason. Absent on older callers. */
  skippedFiles?: SkippedFile[];
  /**
   * The folder's own `.git`, when it has one that can be read. Its files are
   * never loaded as sources. It is only asked which files recent commits changed.
   */
  git?: GitFiles;
};

export type FolderPreview = {
  folderName: string;
  selected: number;
  keep: number;
  pdfs: number;
  skipped: number;
  truncated: boolean;
  /** Files left out because the selection is over the file or size limit. */
  overLimit: number;
  /** The limits the preview was counted against. */
  limits: FolderLimits;
  includeTests: boolean;
  skipLabels: string[];
  keepSample: string[];
};

export type FolderLoad = {
  pack: RepoPack;
  selected: number;
  skipped: number;
  truncated: boolean;
  failed: string[];
  skipLabels: string[];
  /** Every selected file that is not in `pack`, with the reason. */
  skippedFiles: SkippedFile[];
  /**
   * Loaded files a recent commit changed, when the folder had a readable
   * `.git`. Paths, short commit ids and dates only. Empty otherwise.
   */
  recentChanges?: FileChange[];
  /** The load was stopped part-way (`isCancelled`). `pack` is incomplete. */
  cancelled?: boolean;
};

export type FsEntry =
  | { kind: "file"; name: string; getFile: () => Promise<File> }
  | { kind: "directory"; name: string; values: () => AsyncIterable<FsEntry> };

export type DirectoryLike = {
  name: string;
  values: () => AsyncIterable<FsEntry>;
};

export { officeReadError };

export const SKIP_LABEL = {
  vendor: "vendor and build folders",
  generated: "generated files",
  lockfiles: "lockfiles",
  binaries: "binaries and media",
  types: "unsupported types",
  size: "files over the size limit",
  json: "large JSON",
  tests: "tests",
  /** Follows the limits in force, so the reason names the number that was hit. */
  get cap(): string {
    return fileCapLabel();
  },
  get total(): string {
    return totalCapLabel();
  },
  empty: "files with no text",
  failed: "files we could not read",
  /** A drop larger than one scan walks. The files past that point were never seen, so they have no names. */
  walk: "past the number of files one drop reads",
} as const;

export function emptySelectionMessage(
  { selected, skipLabels, failed = [] }: Pick<FolderLoad, "selected" | "skipLabels"> & Partial<Pick<FolderLoad, "failed">>,
): string {
  const chooseFiles = "Choose code, Markdown, text, PDF, Word, Excel, or PowerPoint files.";
  if (!selected && skipLabels.length === 0) return `No files were selected. ${chooseFiles}`;
  const reasons = new Set(skipLabels);
  const explanations = {
    [SKIP_LABEL.vendor]: ["were in build or dependency folders", "was in a build or dependency folder"],
    [SKIP_LABEL.generated]: ["were generated files", "was a generated file"],
    [SKIP_LABEL.lockfiles]: ["were lock files", "was a lock file"],
    [SKIP_LABEL.binaries]: ["were images, archives, or other non-text files", "was an image, archive, or other non-text file"],
    [SKIP_LABEL.types]: ["were in unsupported formats", "was in an unsupported format"],
    [SKIP_LABEL.size]: ["were too large", "was too large"],
    [SKIP_LABEL.json]: ["were large JSON files", "was a large JSON file"],
    [SKIP_LABEL.tests]: ["were excluded tests", "was an excluded test"],
    [SKIP_LABEL.empty]: ["had no readable text", "had no readable text"],
    [SKIP_LABEL.failed]: ["could not be opened", "could not be opened"],
  } as const;
  const singular = selected === 1 && reasons.size === 1;
  const details = Object.entries(explanations)
    .filter(([reason]) => reasons.has(reason))
    .map(([, detail]) => detail[singular ? 1 : 0]);
  const intro = selected <= 1 ? "The selected file" : `All ${selected.toLocaleString()} selected files`;
  let summary = selected === 0 || (selected === 1 && !singular && details.length > 1)
    ? "Nothing in that selection could be indexed"
    : `${intro} could not be indexed`;
  if (selected > 0 && details.length === 1) {
    summary = `${intro} ${details[0]}`;
  } else if (selected === 0 && details.length === 1) {
    summary += `: files ${details[0]}`;
  } else if (details.length > 1) {
    const list = new Intl.ListFormat("en", { type: "disjunction" }).format(details);
    summary += `: some files ${list}`;
  }

  let next = chooseFiles;
  if (reasons.has(SKIP_LABEL.tests)) next = "Turn on Include tests or choose different material.";
  else if (reasons.has(SKIP_LABEL.json)) next = "Use Add files to select the JSON files directly.";
  else if (reasons.has(SKIP_LABEL.size)) next = "Choose smaller files or split the larger ones.";
  else if (reasons.has(SKIP_LABEL.failed)) next = failed.length === 1
    ? `Check that ${failed[0]} opens, or choose different material.`
    : "Check that you can open the files, or choose different material.";
  else if (reasons.has(SKIP_LABEL.vendor) || reasons.has(SKIP_LABEL.generated)) next = "Choose the source folder or the original files.";
  return `${summary}. ${next}`;
}

/** "5,000 files or 50 MB" */
export function describeLimits(limits: FolderLimits = folderLimits()): string {
  return `${limits.maxFiles.toLocaleString("en-US")} files or ${formatBytes(limits.maxTotalBytes)}`;
}

export function truncationNotice(fileCount: number, overLimit = 0): string {
  const left =
    overLimit > 0
      ? `${overLimit.toLocaleString("en-US")} more ${overLimit === 1 ? "is" : "are"} over the limit for one selection (${describeLimits()}) and ${overLimit === 1 ? "is" : "are"} listed under the index chip.`
      : "Some files were skipped due to size limits and are listed under the index chip.";
  return `Loaded ${fileCount.toLocaleString("en-US")} files. ${left} For best results, load a service folder (src/) rather than the full repo root.`;
}

function relativePath(file: File): string {
  const webkit = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return webkit && webkit.length > 0 ? webkit : file.name;
}

function extOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function langOf(path: string): string {
  const ext = extOf(path);
  if (ext === "tsx" || ext === "ts" || ext === "jsx" || ext === "js" || ext === "mjs" || ext === "cjs") return "ts";
  if (ext === "md" || ext === "mdx") return "md";
  if (isOfficeExt(ext)) return ext;
  return ext || "txt";
}

export function isTestPath(path: string): boolean {
  const p = path.toLowerCase();
  return /\.(spec|test|e2e)\./.test(p) || /(^|\/)(__tests__|testdata|fixtures|mocks|stories|e2e)(\/|$)/.test(p);
}

function looksText(text: string): boolean {
  if (text.includes("\0")) return false;
  let weird = 0;
  const n = Math.min(text.length, 800);
  for (let i = 0; i < n; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32) || c === 0xfffd) weird += 1;
  }
  return weird / Math.max(n, 1) < 0.08;
}

function decodeFileText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

function scorePath(path: string): number {
  const p = path.toLowerCase();
  let score = 0;
  if (/(^|\/)(src|lib|internal|pkg|cmd|app|apps|services|service|api|server|core|backend|domain|handlers|usecase)(\/|$)/.test(p)) {
    score += 10;
  }
  if (/\.(ts|tsx|go|py|java|rs|kt)$/.test(p)) score += 6;
  if (/\.(docx|xlsx|csv|ppt|pptx)$/.test(p)) score += 8;
  if (/\.(js|jsx|rb|cs)$/.test(p)) score += 3;
  if (/(adr|architecture|rfc|design-doc)/.test(p)) score += 7;
  if (/(^|\/)docs\//.test(p) && /\.md$/.test(p)) score += 4;
  if (isTestPath(p)) {
    score -= 10;
  }
  // Schema files answer "which table holds X?", the most common data question
  // in a meeting, so a migration is material, not noise.
  if (/\.sql$/.test(p)) score += 6;
  else if (/(^|\/)migrations(\/|$)/.test(p)) score -= 6;
  if (/(^|\/)(fixtures|snapshots|__snapshots__)(\/|$)/.test(p)) score -= 6;
  if (/(jenkins|_scm_|github\/workflows|environment-mapping|site-packages|dist-packages|deno-deck-venv)/.test(p)) {
    score -= 40;
  }
  if (/(^|\/)__init__\.py$/.test(p)) score -= 5;
  if (/\.(yml|yaml)$/.test(p) && !/(^|\/)(src|docs)\//.test(p)) score -= 8;
  if (/\.json$/.test(p)) score -= 2;
  const depth = p.split("/").length;
  if (depth <= 4) score += 2;
  if (depth > 8) score -= 2;
  return score;
}

export function preferredOpenFile(pack: RepoPack): string | null {
  if (pack.files.length === 0) return null;
  const ranked = [...pack.files].sort(
    (a, b) => scorePath(b.path) - scorePath(a.path) || a.path.localeCompare(b.path),
  );
  return ranked[0]?.path ?? null;
}

const CODE_FILE = /\.(ts|tsx|js|jsx|go|py|java|rs|kt)$/i;
const OFFICE_FILE = /\.(docx|xlsx|csv|ppt|pptx|pdf|md)$/i;

/**
 * A pack is "mostly CI/config" only when config files outnumber the few code
 * files. One or two source files on their own are a small pack, not a weak one.
 */
export function isConfigHeavy(paths: string[]): boolean {
  const code = paths.filter((p) => CODE_FILE.test(p)).length;
  const docs = paths.filter((p) => OFFICE_FILE.test(p)).length;
  const other = paths.length - code - docs;
  return paths.length > 0 && code < 3 && docs === 0 && other > code;
}

/**
 * The path the folder rules judge: the path inside what the person selected.
 *
 * Each first segment within a grouped drop was explicitly selected, not
 * discovered inside another folder (including names like "build"), so it is
 * not part of what the rules look at. The same holds for `pathPrefix`, the
 * selected folder's own name, which every stored path starts with. Judging it
 * made a folder named `build`, `out`, `dist` or `vendor` load in full and
 * index nothing.
 */
export function storedPathForRules(path: string, pathPrefix = ""): string {
  if (path.startsWith(GROUPED_DROP_STORAGE_PREFIX)) {
    return dropFirstPathSegment(path.slice(GROUPED_DROP_STORAGE_PREFIX.length));
  }
  return pathPrefix && path.startsWith(pathPrefix) ? path.slice(pathPrefix.length) : path;
}

/** True when a stored file sits in a vendor or build folder and is never indexed. */
export function inSkippedFolder(path: string, pathPrefix = ""): boolean {
  return shouldSkipDirectory(storedPathForRules(path, pathPrefix));
}

/** Files that look like source or documents, by the same score the file limit ranks on. */
function looksLikeMaterial(path: string): boolean {
  return scorePath(storedPathForRules(path)) >= 2;
}

/**
 * "Mostly CI/config" is judged on the files that look like source or
 * documents. Config that sits beside real code is not a warning.
 */
export function isWeakPack(paths: string[]): boolean {
  return isConfigHeavy(paths.filter(looksLikeMaterial));
}

/**
 * Orders a pack best-first and removes vendor and build folders.
 *
 * It used to also remove every file whose path scored under 2: any YAML or
 * JSON outside `src/`, every test, and any file in a language or folder the
 * score does not know (`plugins/tax/VatRates.php`, `web/forms/Amount.vue`).
 * Those files had passed the load filters and were stored, then were never
 * chunked, and nothing said so. The score now only orders files and ranks
 * them for the file limit; it does not decide what is searchable.
 *
 * `prefixOf` returns the selected folder's prefix for a stored path, so the
 * folder's own name is not judged. Packs that were never stored have none.
 */
export function prunePack(
  pack: RepoPack,
  prefixOf: (path: string) => string = () => "",
): { pack: RepoPack; weak: boolean; dropped: number } {
  const kept = pack.files
    .filter((f) => !inSkippedFolder(f.path, prefixOf(f.path)))
    .sort((a, b) => scorePath(b.path) - scorePath(a.path) || a.path.localeCompare(b.path));
  const dropped = pack.files.length - kept.length;
  const next = kept.length > 0 ? { ...pack, files: kept, description: `Local folder · ${kept.length} files` } : pack;
  return { pack: next, dropped, weak: isWeakPack(kept.map((f) => f.path)) };
}

function dropFirstPathSegment(path: string): string {
  return path.slice(path.indexOf("/") + 1);
}

export function repoRelativePath(file: File): string {
  return dropFirstPathSegment(relativePath(file));
}

export function folderNameFromList(list: FileList | File[]): string {
  const files = Array.from(list);
  const first = files[0] ? relativePath(files[0]) : "repo";
  return first.includes("/") ? first.split("/")[0] : "local-repo";
}

export function pathSkipReason(path: string, project = true): string | null {
  const directory = path.slice(0, Math.max(0, path.lastIndexOf("/")));
  if (!path || shouldSkipDirectory(directory)) return SKIP_LABEL.vendor;
  if (isOfficeLockPath(path) || SKIP_NAME.test(path) || /\.lock$/i.test(path)) return SKIP_LABEL.lockfiles;
  if (SKIP_EXT.test(path)) return SKIP_LABEL.binaries;
  if (project && GENERATED_EXT.test(path)) return SKIP_LABEL.generated;
  if (extOf(path) === "pdf") return null;
  if (!ALLOW_EXT.has(extOf(path)) && !ALLOW_NAME.test(path.split("/").pop() ?? "")) return SKIP_LABEL.types;
  return null;
}

export function sizeSkipReason(path: string, size: number, project = true): string | null {
  const ext = extOf(path);
  if (size === 0) return SKIP_LABEL.empty;
  if (size > (isOfficeExt(ext) ? OFFICE_MAX_FILE_BYTES : MAX_FILE_BYTES)) return SKIP_LABEL.size;
  if (project && ext === "json" && size > 12_000 && !/(^|\/)(package\.json|tsconfig.*\.json)$/i.test(path)) return SKIP_LABEL.json;
  return null;
}

/** The outermost folder of `path` that the folder rules leave out, or null when none does. */
function skippedFolderOf(path: string): string | null {
  const parts = path.split("/");
  for (let depth = 1; depth < parts.length; depth += 1) {
    const dir = parts.slice(0, depth).join("/");
    if (shouldSkipDirectory(dir)) return dir;
  }
  return null;
}

export function scanFileList(
  list: FileList | File[],
  options?: Pick<FolderLoadOptions, "skipLabels" | "skippedFiles">,
): FolderScan {
  const files = Array.from(list);
  const skipLabels = new Set(options?.skipLabels);
  const skippedFiles: SkippedFile[] = [...(options?.skippedFiles ?? [])];
  const candidates: FolderCandidate[] = [];
  const pdfs: File[] = [];
  const gitFiles = new Map<string, Blob>();
  // A vendor or build folder is one line with a count, as it is when a folder
  // is walked by handle. A `node_modules` named file by file is tens of
  // thousands of lines that say the same thing.
  const skippedFolders = new Map<string, SkippedFile>();
  for (const file of files) {
    const path = repoRelativePath(file);
    const grouped = groupedDropFiles.has(file);
    // The picked folder's own history. Several folders dropped together each
    // have their own, and are not told apart here, so they get none.
    if (!grouped && path.startsWith(".git/")) gitFiles.set(path.slice(".git/".length), file);
    const project = grouped ? path.includes("/") : Boolean(file.webkitRelativePath);
    const pathForRules = grouped ? dropFirstPathSegment(path) : path;
    const pathReason = pathSkipReason(pathForRules, project);
    if ((!pathReason || pathReason === SKIP_LABEL.types) && isPdfFile(file)) {
      pdfs.push(file);
      continue;
    }
    const skip = pathReason ?? sizeSkipReason(pathForRules, file.size, project);
    if (skip) {
      skipLabels.add(skip);
      const folder = skip === SKIP_LABEL.vendor ? skippedFolderOf(pathForRules) : null;
      if (folder === null) {
        skippedFiles.push({ path, reason: skip });
        continue;
      }
      const folderPath = `${path.slice(0, path.length - pathForRules.length)}${folder}/`;
      const held = skippedFolders.get(folderPath);
      if (held) held.count = (held.count ?? 0) + 1;
      else {
        const entry: SkippedFile = { path: folderPath, reason: skip, count: 1 };
        skippedFolders.set(folderPath, entry);
        skippedFiles.push(entry);
      }
      continue;
    }
    candidates.push({ file, path, pathForRules, score: scorePath(pathForRules) });
  }
  return {
    selected: files.length,
    folderName: folderNameFromList(files),
    candidates,
    pdfs,
    skipLabels: [...skipLabels],
    failed: [],
    skippedFiles,
    ...(gitFiles.has("HEAD") ? { git: gitFilesFromMap(gitFiles) } : {}),
  };
}

export function previewScan(scan: FolderScan, options?: FolderLoadOptions): FolderPreview {
  const includeTests = options?.includeTests ?? true;
  const { candidates, skipLabels } = rankedCandidates(scan, includeTests);
  const limits = { ...folderLimits(), ...(options?.limits ?? {}) };
  const keep: FolderCandidate[] = [];
  let total = 0;
  let overLimit = 0;
  for (const item of candidates) {
    const reason = capReason(keep.length, total, item.file.size, limits);
    if (reason) {
      overLimit += 1;
      skipLabels.add(reason);
      continue;
    }
    total += item.file.size;
    keep.push(item);
  }
  return {
    folderName: scan.folderName,
    selected: scan.selected,
    keep: keep.length,
    pdfs: scan.pdfs.length,
    skipped: Math.max(0, scan.selected - scan.pdfs.length - keep.length),
    truncated: overLimit > 0,
    overLimit,
    limits,
    includeTests,
    skipLabels: [...skipLabels],
    keepSample: keep.slice(0, 3).map((item) => item.path),
  };
}

export function previewFolder(list: FileList | File[], options?: FolderLoadOptions): FolderPreview {
  return previewScan(scanFileList(list), options);
}

function fileWithRelativePath(file: File, relative: string): File {
  try {
    Object.defineProperty(file, "webkitRelativePath", { value: relative, configurable: true });
    return file;
  } catch {
    const copy = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
    Object.defineProperty(copy, "webkitRelativePath", { value: relative, configurable: true });
    return copy;
  }
}

async function countDirectoryFiles(dir: DirectoryLike): Promise<number> {
  let total = 0;
  for await (const entry of dir.values()) {
    if (entry.kind === "directory") total += await countDirectoryFiles(entry);
    else total += 1;
  }
  return total;
}

export async function scanDirectoryHandle(handle: DirectoryLike): Promise<FolderScan> {
  const folderName = handle.name || "local-repo";
  const skipLabels = new Set<string>();
  const candidates: FolderCandidate[] = [];
  const pdfs: File[] = [];
  const failed: string[] = [];
  const skippedFiles: SkippedFile[] = [];
  let selected = 0;
  const history: { dir: DirectoryLike | null } = { dir: null };

  async function walk(dir: DirectoryLike, prefix: string): Promise<void> {
    for await (const entry of dir.values()) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        if (rel === ".git") history.dir = entry;
        if (shouldSkipDirectory(rel)) {
          skipLabels.add(SKIP_LABEL.vendor);
          // Not opened: one line for the folder, with how many files it held.
          const count = await countDirectoryFiles(entry);
          selected += count;
          if (count > 0) skippedFiles.push({ path: `${rel}/`, reason: SKIP_LABEL.vendor, count });
          continue;
        }
        await walk(entry, rel);
        continue;
      }
      selected += 1;
      const pathReason = pathSkipReason(rel);
      if (pathReason && pathReason !== SKIP_LABEL.types) {
        skipLabels.add(pathReason);
        skippedFiles.push({ path: rel, reason: pathReason });
        continue;
      }
      let file: File;
      try {
        file = fileWithRelativePath(await entry.getFile(), `${folderName}/${rel}`);
      } catch {
        skipLabels.add(SKIP_LABEL.failed);
        failed.push(entry.name);
        skippedFiles.push({ path: rel, reason: SKIP_LABEL.failed });
        continue;
      }
      if (isPdfFile(file)) {
        pdfs.push(file);
        continue;
      }
      const reason = pathReason ?? sizeSkipReason(rel, file.size);
      if (reason) {
        skipLabels.add(reason);
        skippedFiles.push({ path: rel, reason });
        continue;
      }
      candidates.push({ file, path: rel, score: scorePath(rel) });
    }
  }

  await walk(handle, "");
  const git = history.dir ? gitFilesFromDirectory(history.dir) : undefined;
  return { selected, folderName, candidates, pdfs, skipLabels: [...skipLabels], failed, skippedFiles, ...(git ? { git } : {}) };
}

/** `.git` as a directory handle. Each folder is listed once, on first use. */
export function gitFilesFromDirectory(root: DirectoryLike): GitFiles {
  const listings = new Map<string, Promise<Map<string, FsEntry>>>();
  const entriesOf = (dir: DirectoryLike, key: string): Promise<Map<string, FsEntry>> => {
    let listing = listings.get(key);
    if (!listing) {
      listing = (async () => {
        const out = new Map<string, FsEntry>();
        for await (const entry of dir.values()) out.set(entry.name, entry);
        return out;
      })();
      listings.set(key, listing);
    }
    return listing;
  };
  const find = async (path: string): Promise<FsEntry | DirectoryLike | null> => {
    let dir: DirectoryLike = root;
    let key = "";
    const parts = path.split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i += 1) {
      const entry = (await entriesOf(dir, key)).get(parts[i]);
      if (!entry) return null;
      if (i === parts.length - 1) return entry;
      if (entry.kind !== "directory") return null;
      dir = entry;
      key = `${key}/${parts[i]}`;
    }
    return root;
  };
  return {
    file: async (path) => {
      try {
        const entry = await find(path);
        return entry && "kind" in entry && entry.kind === "file" ? await entry.getFile() : null;
      } catch {
        return null;
      }
    },
    list: async (dir) => {
      try {
        const entry = await find(dir);
        if (!entry || ("kind" in entry && entry.kind !== "directory")) return [];
        const key = `/${dir.split("/").filter(Boolean).join("/")}`;
        return [...(await entriesOf(entry as DirectoryLike, key === "/" ? "" : key)).keys()];
      } catch {
        return [];
      }
    },
  };
}

function capReason(count: number, totalBytes: number, nextBytes: number, limits: FolderLimits): string | null {
  if (count >= limits.maxFiles) return fileCapLabel(limits);
  if (totalBytes + nextBytes > limits.maxTotalBytes) return totalCapLabel(limits);
  return null;
}

function rankedCandidates(
  scan: FolderScan,
  includeTests: boolean,
): { candidates: FolderCandidate[]; skipLabels: Set<string>; skippedFiles: SkippedFile[] } {
  const skippedFiles = [...(scan.skippedFiles ?? [])];
  const candidates = [...scan.candidates]
    .filter((item) => {
      if (includeTests || !isTestPath(item.pathForRules ?? item.path)) return true;
      skippedFiles.push({ path: item.path, reason: SKIP_LABEL.tests });
      return false;
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const skipLabels = new Set(scan.skipLabels);
  if (!includeTests && candidates.length < scan.candidates.length) skipLabels.add(SKIP_LABEL.tests);
  return { candidates, skipLabels, skippedFiles };
}

export async function packFromScan(scan: FolderScan, options?: FolderLoadOptions): Promise<FolderLoad> {
  const { candidates, skipLabels, skippedFiles } = rankedCandidates(scan, options?.includeTests ?? true);
  for (const label of options?.skipLabels ?? []) skipLabels.add(label);
  // Every `continue` below records the file it leaves out. A file must not
  // disappear between the selection and the index without a line here.
  const seen = new Set(skippedFiles.map((item) => item.path));
  for (const item of options?.skippedFiles ?? []) {
    if (!seen.has(item.path)) skippedFiles.push(item);
  }
  const selected = options?.selectedCount ?? scan.selected;
  const limits = { ...folderLimits(), ...(options?.limits ?? {}) };
  const packFiles: RepoFile[] = [];
  const failed = [...scan.failed];
  let total = 0;
  let truncated = false;
  let cancelled = false;
  let read = 0;
  for (const item of candidates) {
    // Asked per file: the person may have moved to another space, and the
    // rest of a few thousand files is then read for nothing.
    if (options?.isCancelled?.()) {
      cancelled = true;
      break;
    }
    // Reported at the top so every `continue` below is counted too.
    options?.onRead?.(read, candidates.length);
    read += 1;
    const reason = capReason(packFiles.length, total, item.file.size, limits);
    if (reason) {
      truncated = true;
      skipLabels.add(reason);
      skippedFiles.push({ path: item.path, reason });
      continue;
    }
    const ext = extOf(item.path);
    let content = "";
    try {
      const buffer = await item.file.arrayBuffer();
      if (isOfficeExt(ext) && ext !== "csv") {
        content = await parseOfficeBuffer(ext, buffer);
      } else {
        content = decodeFileText(buffer);
        if (!looksText(content)) {
          skipLabels.add(SKIP_LABEL.binaries);
          skippedFiles.push({ path: item.path, reason: SKIP_LABEL.binaries });
          continue;
        }
        if (ext === "csv") content = parseCsvText(content);
      }
    } catch (error) {
      console.warn(`Could not read ${item.path}`, error);
      failed.push(item.path.split("/").pop() ?? item.path);
      skipLabels.add(SKIP_LABEL.failed);
      skippedFiles.push({ path: item.path, reason: SKIP_LABEL.failed });
      continue;
    }
    if (!content.trim()) {
      skipLabels.add(SKIP_LABEL.empty);
      skippedFiles.push({ path: item.path, reason: SKIP_LABEL.empty });
      continue;
    }
    total += item.file.size;
    packFiles.push({ path: item.path, language: langOf(item.path), content });
  }
  if (!cancelled) options?.onRead?.(candidates.length, candidates.length);

  // Which of the loaded files recent commits changed. Optional in every way:
  // no `.git`, or one that cannot be read, leaves this empty.
  let recentChanges: FileChange[] = [];
  const git = scan.git ?? options?.git;
  if (git && packFiles.length > 0 && !cancelled) {
    const loaded = new Set(packFiles.map((file) => file.path));
    try {
      recentChanges = (await readRecentChanges(git)).filter((change) => loaded.has(change.path));
    } catch {
      recentChanges = [];
    }
  }

  return {
    pack: {
      id: `folder-${scan.folderName}`,
      name: scan.folderName,
      description: `Local folder · ${packFiles.length} files`,
      files: packFiles,
      commits: [],
    },
    selected,
    skipped: Math.max(0, selected - scan.pdfs.length - packFiles.length),
    truncated,
    failed,
    skipLabels: [...skipLabels],
    skippedFiles,
    recentChanges,
    ...(cancelled ? { cancelled: true } : {}),
  };
}

export async function packFromFiles(list: FileList | File[], options?: FolderLoadOptions): Promise<FolderLoad> {
  return packFromScan(scanFileList(list), options);
}
