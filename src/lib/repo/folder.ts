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
]);

const MAX_FILES = 500;
const MAX_FILE_BYTES = 150_000;
const MAX_TOTAL_BYTES = 8_000_000;

export type FolderLoad = {
  pack: RepoPack;
  skipped: number;
  truncated: boolean;
};

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
  return ext || "txt";
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
  if (/\.(js|jsx|rb|cs)$/.test(p)) score += 3;
  if (/(adr|architecture|rfc|design-doc)/.test(p)) score += 7;
  if (/(^|\/)docs\//.test(p) && /\.md$/.test(p)) score += 4;
  if (/\.(spec|test|e2e)\./.test(p) || /(^|\/)(__tests__|testdata|fixtures|mocks|stories|e2e)(\/|$)/.test(p)) {
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
  const next = kept.length > 0 ? { ...pack, files: kept, description: `Local folder · ${kept.length} files` } : pack;
  return { pack: next, dropped, weak: code < 3 };
}

export async function packFromFiles(list: FileList | File[]): Promise<FolderLoad> {
  const files = Array.from(list);
  const first = files[0] ? relativePath(files[0]) : "repo";
  const root = first.includes("/") ? first.split("/")[0] : "local-repo";

  const candidates: Array<{ file: File; path: string; score: number }> = [];
  let skipped = 0;
  for (const file of files) {
    const rel = relativePath(file);
    const path = rel.includes("/") ? rel.split("/").slice(1).join("/") : rel;
    if (!path || SKIP_DIR.test(path) || SKIP_NAME.test(path) || SKIP_EXT.test(path)) {
      skipped += 1;
      continue;
    }
    const ext = extOf(path);
    if (!ALLOW_EXT.has(ext)) {
      skipped += 1;
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      skipped += 1;
      continue;
    }
    if (ext === "json" && file.size > 12_000 && !/(^|\/)(package\.json|tsconfig.*\.json)$/i.test(path)) {
      skipped += 1;
      continue;
    }
    candidates.push({ file, path, score: scorePath(path) });
  }

  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const packFiles: RepoFile[] = [];
  let total = 0;
  let truncated = false;
  for (const item of candidates) {
    if (packFiles.length >= MAX_FILES) {
      truncated = true;
      skipped += 1;
      continue;
    }
    if (total + item.file.size > MAX_TOTAL_BYTES) {
      truncated = true;
      skipped += 1;
      continue;
    }
    let content = "";
    try {
      content = await item.file.text();
    } catch {
      skipped += 1;
      continue;
    }
    if (!looksText(content)) {
      skipped += 1;
      continue;
    }
    total += item.file.size;
    packFiles.push({ path: item.path, language: langOf(item.path), content });
  }

  return {
    pack: {
      id: `folder-${root}`,
      name: root,
      description: `Local folder · ${packFiles.length} files`,
      files: packFiles,
      commits: [],
    },
    skipped,
    truncated,
  };
}
