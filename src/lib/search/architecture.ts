import type { Card, Citation, RepoFile, RepoPack } from "@/lib/repo/types";
import { provenanceLabel } from "./cite.ts";
import { textEvidence, verifyClaim } from "./evidence.ts";
import { type ProseSpan, capabilityList, countWord, proseOf } from "./prose.ts";
import { sayable } from "./say.ts";

type Purpose = { file: RepoFile; description: ProseSpan; capabilities: ProseSpan[] };

/** What this file says it does, if anything. A title is not a purpose. */
function spokenLine(file: RepoFile): Purpose | null {
  const prose = proseOf(file);
  if (!prose?.description) return null;
  return { file, description: prose.description, capabilities: prose.capabilities };
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

/**
 * Path-specific on purpose. This ranking prefers the README and shallow entry
 * points because those are where a repo states what it is, which is only the
 * right place to look when the question is about the whole app. It is reached
 * through `architectureCard` alone, and `compose` only calls that for a
 * question with no subject of its own (`asksAboutWholeApp`). Any other question
 * is ranked by `retrieve`, where a file name has to be backed by the file's text.
 */
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

const ROOT_README = /^readme\.(md|mdx|rst|txt)$/i;
const ARCHITECTURE_DOC = /^(?:docs\/)?architecture\.md$/i;

function briefingSpans(file: RepoFile, limit: number): ProseSpan[] {
  const prose = proseOf(file);
  if (!prose?.description) return [];
  return [prose.description, ...(prose.more ?? [])].slice(0, limit);
}

const MD_LINK = /\[[^\]]+\]\(([^)\s]+)\)/g;

/** The first in-repo doc a README names. Web links and files already opened are skipped. */
function linkedDoc(readme: RepoFile, pack: RepoPack, opened: Set<string>): RepoFile | null {
  for (const match of readme.content.matchAll(MD_LINK)) {
    const path = match[1].split("#")[0].replace(/^\.\//, "");
    if (!path || /^https?:/i.test(path)) continue;
    const file = pack.files.find((item) => item.path === path);
    if (!file || opened.has(file.path)) continue;
    return file;
  }
  return null;
}

/**
 * Body rows of a Tools table, spoken as the cells the file wrote.
 * A heading row and the separator are not claims.
 */
function toolRows(file: RepoFile, limit: number): ProseSpan[] {
  const rows: ProseSpan[] = [];
  let offset = 0;
  let inTools = false;
  for (const line of file.content.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    if (/^##\s+tools\b/i.test(line)) {
      inTools = true;
      continue;
    }
    if (inTools && /^#{1,6}\s+/.test(line)) break;
    if (!inTools || !line.startsWith("|")) continue;
    if (/^\|\s*[-: ]+\|/.test(line) || /^\|\s*tool\s*\|/i.test(line)) continue;
    const cells = line
      .split("|")
      .map((cell) => cell.replace(/`/g, "").trim())
      .filter((cell) => cell.length > 0 && !/^tier\s*\d*$/i.test(cell) && cell !== "-");
    if (cells.length < 2) continue;
    const text = `${cells[0]}. ${cells[cells.length - 1]}`;
    if (text.length < 12 || text.length > 220) continue;
    rows.push({ raw: line, text, start, end: start + line.length });
    if (rows.length >= limit) break;
  }
  return rows;
}

/**
 * The files Cursor opens for "what is this project": the root README, then the
 * architecture doc. Each spoken sentence is one the file already wrote.
 * A nested inventory that merely contains the word "project" does not get a turn.
 * Silence when the root README does not state what the project is.
 */
export function readmeOverviewCard(pack: RepoPack, query: string, latencyMs: number): Card {
  const readme = pack.files.find((item) => ROOT_README.test(item.path));
  const readmeSpans = readme ? briefingSpans(readme, 3) : [];
  if (!readme || readmeSpans.length === 0) {
    return silent(query, latencyMs, "Nothing in this material says what it does.");
  }
  const architecture = pack.files.find((item) => ARCHITECTURE_DOC.test(item.path));
  const pieces: Array<{ file: RepoFile; span: ProseSpan }> = readmeSpans.map((span) => ({ file: readme, span }));
  const opened = new Set<string>([readme.path]);
  if (architecture) {
    opened.add(architecture.path);
    for (const span of briefingSpans(architecture, 2)) pieces.push({ file: architecture, span });
  }
  const linked = linkedDoc(readme, pack, opened);
  if (linked) {
    opened.add(linked.path);
    for (const span of briefingSpans(linked, 1)) pieces.push({ file: linked, span });
  }
  for (const span of toolRows(readme, 4)) pieces.push({ file: readme, span });

  for (let count = pieces.length; count >= 1; count -= 1) {
    const chosen = pieces.slice(0, count);
    const say = sayable(chosen.map((piece) => piece.span.text).join(" "));
    if (!say) continue;
    const evidence = [];
    const citations: Citation[] = [];
    let built = true;
    const byFile = new Map<string, { file: RepoFile; start: number; end: number }>();
    for (const piece of chosen) {
      const current = byFile.get(piece.file.path);
      if (!current) {
        byFile.set(piece.file.path, { file: piece.file, start: piece.span.start, end: piece.span.end });
      } else {
        current.start = Math.min(current.start, piece.span.start);
        current.end = Math.max(current.end, piece.span.end);
      }
    }
    for (const group of byFile.values()) {
      const span = textEvidence({
        path: group.file.path,
        content: group.file.content,
        start: group.start,
        end: group.end,
        normalizedText: say,
      });
      if (!span) {
        built = false;
        break;
      }
      evidence.push(span);
      citations.push({
        kind: "file",
        path: group.file.path,
        line: span.startLine,
        endLine: span.endLine,
        evidenceId: span.id,
        ...provenance(pack, group.file.path),
      });
    }
    if (!built || !verifyClaim(say, evidence).ok) continue;
    return { say, citations, evidence, query, latencyMs, source: "local" };
  }
  return silent(query, latencyMs, "Nothing in this material says what it does.");
}

/**
 * Structural answers are grounded in the file tree itself, not in lexical hits:
 * "what is this" is answered by the shape of the loaded material, and every
 * citation is a real loaded path. Retrieval still runs first and specific
 * answers still win, so this cannot outrank real evidence — see localCard.
 */
export function architectureCard(pack: RepoPack, query: string, latencyMs: number): Card {
  // Deliberately takes no hits. "How does this application work?" shares no
  // vocabulary with the code it is about, so requiring a ranked hit would
  // silence the one question this path exists to answer. What keeps it honest is
  // the same thing that keeps every other claim honest: the sentence is
  // extracted from a real file and verified against it below.

  // Purpose comes from a file, never from the directory tree.
  const purpose = purposeCandidates(pack).map(spokenLine).find(Boolean);
  if (!purpose) {
    return silent(query, latencyMs, "Nothing in this material says what it does.");
  }

  const framework = frameworkOf(pack);
  const kind = framework ? `${framework} service` : "service";
  // Mid-sentence after the dash, so "This service…" reads "this service…";
  // acronyms such as "REST API…" keep their case.
  const described = trimTail(purpose.description.text).replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());
  let say = `${pack.name} is a ${kind} — ${described}`;
  // Bulleted capabilities only enrich a thin description; they never replace it.
  const spoken = purpose.capabilities.slice(0, 4);
  const listed = purpose.capabilities.length >= 2 && purpose.description.text.length < 60;
  // The list is its own sentence: the description and the bullets usually sit
  // in different paragraphs, and one clause spanning both fails the order check.
  const remainder = Math.max(0, purpose.capabilities.length - spoken.length);
  say += ".";
  if (listed) {
    say += ` It covers ${capabilityList(purpose.capabilities.map((c) => c.text))}.`;
  }

  // Structure is a second clause only, and only after purpose is established.
  const main = topDirs(pack)
    .map((dir) => ({ dir, parts: componentsUnder(pack, dir) }))
    .filter((group) => group.parts.length >= 2 && speakableGroup(group.dir))
    .sort((a, b) => b.parts.length - a.parts.length)[0];
  if (main) {
    say += ` Work is split across ${countWord(main.parts.length)} ${humanize(main.dir)}.`;
  }

  // The purpose sentence is the only part read from prose, so it is the only
  // part that gets a span — and the citation quotes the line it occupies rather
  // than the head of the file it happens to live in.
  const used = listed ? [purpose.description, ...spoken] : [purpose.description];
  const span = textEvidence({
    path: purpose.file.path,
    content: purpose.file.content,
    start: Math.min(...used.map((p) => p.start)),
    end: Math.max(...used.map((p) => p.end)),
    normalizedText: say,
  });
  if (!span) return silent(query, latencyMs, "Nothing in this material says what it does.");

  // The rest of the sentence is drawn from the file tree, not from prose. Those
  // names are declared here so the support check can tell a directory this pack
  // actually contains from a word the composer invented.
  const structural = [
    ...(listed ? ["covers"] : []),
    ...(listed && remainder > 0 ? [`plus ${countWord(remainder)} more`] : []),
    pack.name,
    kind,
    framework ?? "",
    main ? humanize(main.dir) : "",
    ...(main ? [countWord(main.parts.length)] : []),
    ...(main?.parts ?? []),
  ];
  if (!verifyClaim(say, [span], structural).ok) {
    return silent(query, latencyMs, "Nothing in this material says what it does.");
  }

  // One citation, for the one thing that was read. A second chip naming a
  // representative component used to be added here at line 1 — a coordinate
  // nobody measured, pointing at a file that contains none of the spoken
  // sentence. The structural half of the answer is derived from the file tree
  // and declared as `structural` above; it has no line to cite, so it does not
  // get one.
  const cites: Citation[] = [
    {
      kind: "file",
      path: purpose.file.path,
      line: span.startLine,
      endLine: span.endLine,
      evidenceId: span.id,
      ...provenance(pack, purpose.file.path),
    },
  ];

  return {
    say: sayable(say.slice(0, 300)),
    citations: cites,
    evidence: [span],
    query,
    latencyMs,
    source: "local",
  };
}
