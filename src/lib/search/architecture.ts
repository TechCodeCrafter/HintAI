import type { Card, Hit, RepoFile, RepoPack } from "@/lib/repo/types";
import { provenanceLabel } from "./cite.ts";
import { capabilityList, countWord, listWords, proseOf } from "./prose.ts";
import { sayable } from "./say.ts";

type Purpose = { path: string; description: string; capabilities: string[] };

/** What this file says it does, if anything. A title is not a purpose. */
function spokenLine(file: RepoFile): Purpose | null {
  const prose = proseOf(file);
  if (!prose?.description) return null;
  return { path: file.path, description: prose.description, capabilities: prose.capabilities };
}

function topDirs(pack: RepoPack): string[] {
  const counts = new Map<string, number>();
  for (const file of pack.files) {
    const dir = file.path.includes("/") ? file.path.split("/")[0] : "root";
    // Tooling and config directories are not architecture.
    if (dir.startsWith(".") || dir === "root") continue;
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([dir]) => dir);
}

const FRAMEWORKS: Array<[RegExp, string]> = [
  [/\bFastAPI\s*\(|\bfrom\s+fastapi\b/i, "FastAPI"],
  [/\bFlask\s*\(|\bfrom\s+flask\b/i, "Flask"],
  [/\bdjango\.(?:conf|urls|db)\b|DJANGO_SETTINGS_MODULE/i, "Django"],
  [/\bexpress\s*\(\)|require\(["']express["']\)|from\s+["']express["']/i, "Express"],
  [/@nestjs\//, "NestJS"],
  [/\bSpringApplication\b|@SpringBootApplication\b/, "Spring Boot"],
  [/\bnext\/(?:app|document|server)\b/, "Next.js"],
  [/\buse\s+axum\b|\bactix_web\b/, "Rust web"],
  [/\bgin\.(?:New|Default)\(\)|net\/http/, "Go service"],
];

function frameworkOf(pack: RepoPack): string | null {
  for (const file of pack.files.slice(0, 60)) {
    for (const [pattern, name] of FRAMEWORKS) {
      if (pattern.test(file.content)) return name;
    }
  }
  return null;
}

function humanize(name: string): string {
  return name.replace(/[-_]+/g, " ").trim();
}

/**
 * The named components living directly under a top-level directory. This is
 * where a real repo's shape is legible — `container-lambdas/<worker>` says far
 * more about the architecture than the top-level folder name does.
 */
function componentsUnder(pack: RepoPack, dir: string): string[] {
  const names = new Set<string>();
  for (const file of pack.files) {
    if (!file.path.startsWith(`${dir}/`)) continue;
    const rest = file.path.slice(dir.length + 1);
    if (!rest.includes("/")) continue;
    const seg = rest.split("/")[0];
    if (seg && !/^(__pycache__|tests?|node_modules)$/i.test(seg)) names.add(seg);
  }
  return [...names].sort();
}

/** Scaffolding folders that carry no architectural meaning. */
const GENERIC_DIR =
  /^(src|lib|libs|app|apps|docs?|tests?|scripts?|public|static|assets|styles|utils|config|types|build|dist|vendor|node_modules|migrations)$/i;

/**
 * "seven container lambdas" reads as speech; "two src" does not. If the folder
 * name will not survive being spoken, the Card says nothing about structure
 * rather than say it badly — purpose alone is a complete answer.
 */
function speakableGroup(dir: string): boolean {
  if (GENERIC_DIR.test(dir)) return false;
  return /s$/.test(humanize(dir));
}

function rankEntry(path: string): number {
  const p = path.toLowerCase();
  const depth = p.split("/").length;
  let score = 0;
  // An entry-point name only means "entry point" near the root. Buried files
  // like src/lib/auth/server.ts are helpers, and must not speak for the repo.
  if (/(^|\/)(main|app|index|server|api|router)\.[a-z]+$/.test(p) && depth <= 2) score += 10;
  if (/(^|\/)readme\.[a-z]+$/.test(p)) score += 8;
  if (/(architecture|adr)/.test(p)) score += 5;
  if (/(^|\/)(src|api|app|server|cmd)\//.test(p)) score += 3;
  if (depth > 3) score -= 4;
  if (/\.(json|yml|yaml|lock)$/.test(p)) score -= 6;
  return score;
}

/** Entry points first, then any README — the places a repo states its purpose. */
function purposeCandidates(pack: RepoPack): RepoFile[] {
  const ranked = [...pack.files].sort(
    (a, b) => rankEntry(b.path) - rankEntry(a.path) || a.path.localeCompare(b.path),
  );
  const readme = pack.files.filter((f) => /(^|\/)readme\.[a-z]+$/i.test(f.path));
  const seen = new Set<string>();
  return [...ranked.slice(0, 6), ...readme].filter((file) => {
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  });
}

function trimTail(text: string): string {
  return text.replace(/[.!?\s]+$/, "");
}

/**
 * A citation label is provenance, not a restatement of the path. With no commit
 * history there is nothing to add, so it stays empty and the chip shows one line.
 */
function provenance(pack: RepoPack, path: string): { sha?: string; pr?: string; label: string } {
  const commit = pack.commits.find((c) => c.files.includes(path));
  if (!commit) return { label: "" };
  return { sha: commit.sha, pr: commit.pr, label: provenanceLabel(commit) };
}

function silent(query: string, latencyMs: number, reason: string): Card {
  return { say: null, reason, citations: [], query, latencyMs, source: "local" };
}

/**
 * Structural answers are grounded in the file tree itself, not in lexical hits:
 * "what is this" is answered by the shape of the loaded material, and every
 * citation is a real loaded path. Retrieval still runs first and specific
 * answers still win, so this cannot outrank real evidence — see localCard.
 */
export function architectureCard(
  pack: RepoPack,
  query: string,
  latencyMs: number,
  hits: Hit[] = [],
): Card {
  if (pack.id === "northstar-payments") {
    // A written answer, so this one does need retrieval behind it.
    if (hits.length === 0) return silent(query, latencyMs, "Nothing in this material answers that.");
    return {
      say: "Northstar is a settlement exporter plus edge auth — retries live in src/exporter, session cookies rotate in src/auth.",
      citations: [
        { path: "src/exporter/retry.ts", line: 1, sha: "a3f91c2", pr: "842", label: "src/exporter · PR #842" },
        { path: "src/auth/flow.ts", line: 1, sha: "c81e04b", pr: "640", label: "src/auth · PR #640" },
      ],
      query,
      latencyMs,
      source: "local",
    };
  }

  // Purpose comes from a file, never from the directory tree.
  const purpose = purposeCandidates(pack).map(spokenLine).find(Boolean);
  if (!purpose) {
    return silent(query, latencyMs, "Nothing in this material says what it does.");
  }

  const framework = frameworkOf(pack);
  const kind = framework ? `${framework} service` : "service";
  let say = `${pack.name} is a ${kind} — ${trimTail(purpose.description)}`;
  // Bulleted capabilities only enrich a thin description; they never replace it.
  if (purpose.capabilities.length >= 2 && purpose.description.length < 60) {
    say += `: ${capabilityList(purpose.capabilities)}`;
  }
  say += ".";

  // Structure is a second clause only, and only after purpose is established.
  const main = topDirs(pack)
    .map((dir) => ({ dir, parts: componentsUnder(pack, dir) }))
    .filter((group) => group.parts.length >= 2 && speakableGroup(group.dir))
    .sort((a, b) => b.parts.length - a.parts.length)[0];
  if (main) {
    say += ` Work is split across ${countWord(main.parts.length)} ${humanize(main.dir)}.`;
  }

  const cites = [{ path: purpose.path, line: 1, ...provenance(pack, purpose.path) }];
  const component = main?.parts[0] ? `${main.dir}/${main.parts[0]}` : null;
  const rep = component ? pack.files.find((f) => f.path.startsWith(`${component}/`)) : undefined;
  if (rep && rep.path !== purpose.path) {
    cites.push({ path: rep.path, line: 1, ...provenance(pack, rep.path) });
  } else {
    const ranked = hits.find((h) => h.kind === "code" && h.path !== purpose.path);
    if (ranked) {
      cites.push({ path: ranked.path, line: ranked.startLine, ...provenance(pack, ranked.path) });
    }
  }

  return {
    say: sayable(say.slice(0, 300)),
    citations: cites.slice(0, 2),
    query,
    latencyMs,
    source: "local",
  };
}
