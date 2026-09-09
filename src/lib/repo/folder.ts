import { isOfficeExt, officeReadError, parseOfficeBuffer } from "../document/parsers/office-parsers.ts";
import type { RepoFile, RepoPack } from "./types";

const SKIP_DIR =
  /(^|\/)(node_modules|\.git|\.next|\.nuxt|\.turbo|\.cache|\.venv|venv|\.deno|site-packages|dist-packages|lib\/python\d|__pypackages__|\.tox|env|virtualenv|dist|build|coverage|vendor|__pycache__|out|target|\.grok|\.idea|\.vscode|\.yarn|\.pnpm-store|Pods|\.gradle|storybook-static|playwright-report|cypress\/videos|generated|proto-gen|_scm_jenkins|_scm_|jenkins|\.github|\.circleci|\.gitlab)(\/|$)/i;

const SKIP_NAME =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|composer\.lock|\.DS_Store)(\/|$)/i;

const SKIP_EXT =
  /\.(lock|min\.js|map|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp4|mp3|wav|zip|gz|tgz|wasm|pdf|bin|exe|dmg|svg|avif)$/i;

const ALLOW_EXT = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "md",
  "mdx",
  "json",
  "css",
  "scss",
  "sql",
  "yml",
  "yaml",
  "toml",
  "rb",
  "php",
  "swift",
  "cs",
  "vue",
  "svelte",
  "graphql",
  "gql",
  "proto",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "txt",
  "docx",
  "xlsx",
  "csv",
]);

const MAX_FILES = 500;
const MAX_FILE_BYTES = 150_000;
const OFFICE_MAX_FILE_BYTES = 4_000_000;
const MAX_TOTAL_BYTES = 8_000_000;

export type FolderLoadOptions = {
  includeTests?: boolean;
  selectedCount?: number;
};

export type FolderCandidate = {
  file: File;
  path: string;
  score: number;
};

export type FolderScan = {
  selected: number;
  folderName: string;
  candidates: FolderCandidate[];
  skipLabels: string[];
};

export type FolderPreview = {
  folderName: string;
  selected: number;
  keep: number;
  skipped: number;
  truncated: boolean;
  includeTests: boolean;
  skipLabels: string[];
  keepSample: string[];
};

export type FolderLoad = {
  pack: RepoPack;
  skipped: number;
  truncated: boolean;
  failed: string[];
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
  lockfiles: "lockfiles",
  binaries: "binaries and media",
  types: "unsupported types",
  size: "files over the size limit",
  json: "large JSON",
  tests: "tests",
  cap: "over the 500-file cap",
} as const;

export function truncationNotice(fileCount: number): string {
  return `Loaded ${fileCount} files. Some files were skipped due to size limits. For best results, load a service folder (src/) rather than the full repo root.`;
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

function looksText(bytes: string): boolean {
  let weird = 0;
  const n = Math.min(bytes.length, 800);
  for (let i = 0; i < n; i += 1) {
    const c = bytes.charCodeAt(i);
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) weird += 1;
  }
  return weird / Math.max(n, 1) < 0.08;
}

function scorePath(path: string): number {
  const p = path.toLowerCase();
  let score = 0;
  if (/(^|\/)(src|lib|internal|pkg|cmd|app|apps|services|service|api|server|core|backend|domain|handlers|usecase)(\/|$)/.test(p)) {
    score += 10;
  }
  if (/\.(ts|tsx|go|py|java|rs|kt)$/.test(p)) score += 6;
  if (/\.(docx|xlsx|csv)$/.test(p)) score += 8;
  if (/\.(js|jsx|rb|cs)$/.test(p)) score += 3;
  if (/(adr|architecture|rfc|design-doc)/.test(p)) score += 7;
  if (/(^|\/)docs\//.test(p) && /\.md$/.test(p)) score += 4;
  if (isTestPath(p)) {
    score -= 10;
  }
  if (/(^|\/)(migrations|fixtures|snapshots|__snapshots__)(\/|$)/.test(p)) score -= 6;
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

export function prunePack(pack: RepoPack): { pack: RepoPack; weak: boolean; dropped: number } {
  const kept = pack.files
    .filter((f) => !SKIP_DIR.test(f.path) && scorePath(f.path) >= 2)
    .sort((a, b) => scorePath(b.path) - scorePath(a.path) || a.path.localeCompare(b.path));
  const dropped = pack.files.length - kept.length;
  const code = kept.filter((f) => /\.(ts|tsx|js|jsx|go|py|java|rs|kt)$/i.test(f.path)).length;
  const office = kept.filter((f) => /\.(docx|xlsx|csv)$/i.test(f.path)).length;
  const next = kept.length > 0 ? { ...pack, files: kept, description: `Local folder · ${kept.length} files` } : pack;
  return { pack: next, dropped, weak: code < 3 && office === 0 };
}

export function repoRelativePath(file: File): string {
  const rel = relativePath(file);
  return rel.includes("/") ? rel.split("/").slice(1).join("/") : rel;
}

export function folderNameFromList(list: FileList | File[]): string {
  const files = Array.from(list);
  const first = files[0] ? relativePath(files[0]) : "repo";
  return first.includes("/") ? first.split("/")[0] : "local-repo";
}

export function pathSkipReason(path: string): string | null {
  if (!path || SKIP_DIR.test(path)) return SKIP_LABEL.vendor;
  if (SKIP_NAME.test(path)) return SKIP_LABEL.lockfiles;
  if (SKIP_EXT.test(path)) return SKIP_LABEL.binaries;
  if (!ALLOW_EXT.has(extOf(path))) return SKIP_LABEL.types;
  return null;
}

export function sizeSkipReason(path: string, size: number): string | null {
  const ext = extOf(path);
  if (size > (isOfficeExt(ext) ? OFFICE_MAX_FILE_BYTES : MAX_FILE_BYTES)) return SKIP_LABEL.size;
  if (ext === "json" && size > 12_000 && !/(^|\/)(package\.json|tsconfig.*\.json)$/i.test(path)) return SKIP_LABEL.json;
  return null;
}

export function scanFileList(list: FileList | File[]): FolderScan {
  const files = Array.from(list);
  const skipLabels = new Set<string>();
  const candidates: FolderCandidate[] = [];
  for (const file of files) {
    const path = repoRelativePath(file);
    const reason = pathSkipReason(path) ?? sizeSkipReason(path, file.size);
    if (reason) {
      skipLabels.add(reason);
      continue;
    }
    candidates.push({ file, path, score: scorePath(path) });
  }
  return {
    selected: files.length,
    folderName: folderNameFromList(files),
    candidates,
    skipLabels: [...skipLabels],
  };
}

export function previewScan(scan: FolderScan, options?: FolderLoadOptions): FolderPreview {
  const includeTests = options?.includeTests ?? true;
  const ranked = [...scan.candidates]
    .filter((item) => includeTests || !isTestPath(item.path))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const skipLabels = new Set(scan.skipLabels);
  if (!includeTests && scan.candidates.some((item) => isTestPath(item.path))) {
    skipLabels.add(SKIP_LABEL.tests);
  }
  let total = 0;
  let truncated = false;
  const keep: FolderCandidate[] = [];
  for (const item of ranked) {
    if (keep.length >= MAX_FILES || total + item.file.size > MAX_TOTAL_BYTES) {
      truncated = true;
      skipLabels.add(SKIP_LABEL.cap);
      continue;
    }
    total += item.file.size;
    keep.push(item);
  }
  return {
    folderName: scan.folderName,
    selected: scan.selected,
    keep: keep.length,
    skipped: Math.max(0, scan.selected - keep.length),
    truncated,
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
  let selected = 0;

  async function walk(dir: DirectoryLike, prefix: string): Promise<void> {
    for await (const entry of dir.values()) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        if (SKIP_DIR.test(rel)) {
          skipLabels.add(SKIP_LABEL.vendor);
          selected += await countDirectoryFiles(entry);
          continue;
        }
        await walk(entry, rel);
        continue;
      }
      selected += 1;
      const pathReason = pathSkipReason(rel);
      if (pathReason) {
        skipLabels.add(pathReason);
        continue;
      }
      const file = fileWithRelativePath(await entry.getFile(), `${folderName}/${rel}`);
      const sizeReason = sizeSkipReason(rel, file.size);
      if (sizeReason) {
        skipLabels.add(sizeReason);
        continue;
      }
      candidates.push({ file, path: rel, score: scorePath(rel) });
    }
  }

  await walk(handle, "");
  return { selected, folderName, candidates, skipLabels: [...skipLabels] };
}

export async function packFromScan(scan: FolderScan, options?: FolderLoadOptions): Promise<FolderLoad> {
  const includeTests = options?.includeTests ?? true;
  const selected = options?.selectedCount ?? scan.selected;
  const candidates = [...scan.candidates]
    .filter((item) => includeTests || !isTestPath(item.path))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const packFiles: RepoFile[] = [];
  const failed: string[] = [];
  let total = 0;
  let truncated = false;
  for (const item of candidates) {
    if (packFiles.length >= MAX_FILES) {
      truncated = true;
      continue;
    }
    if (total + item.file.size > MAX_TOTAL_BYTES) {
      truncated = true;
      continue;
    }
    const ext = extOf(item.path);
    let content = "";
    try {
      if (isOfficeExt(ext)) {
        content = await parseOfficeBuffer(ext, await item.file.arrayBuffer());
      } else {
        content = await item.file.text();
        if (!looksText(content)) continue;
      }
    } catch (error) {
      console.warn(`Could not read ${item.path}`, error);
      failed.push(item.path.split("/").pop() ?? item.path);
      continue;
    }
    if (!content.trim()) continue;
    total += item.file.size;
    packFiles.push({ path: item.path, language: langOf(item.path), content });
  }

  return {
    pack: {
      id: `folder-${scan.folderName}`,
      name: scan.folderName,
      description: `Local folder · ${packFiles.length} files`,
      files: packFiles,
      commits: [],
    },
    skipped: Math.max(0, selected - packFiles.length),
    truncated,
    failed,
  };
}

export async function packFromFiles(list: FileList | File[], options?: FolderLoadOptions): Promise<FolderLoad> {
  return packFromScan(scanFileList(list), options);
}
