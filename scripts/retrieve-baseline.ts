/**
 * Frozen copy of the retrieval scoring as it was before the P0 fix, kept only
 * so the probe can print a true before/after on identical material.
 * Not imported by the app.
 */
import type { Chunk, Hit, RepoPack } from "../src/lib/repo/types.ts";

const STOP = new Set([
  "a", "an", "the", "that", "this", "does", "did", "do", "we", "you", "in", "of",
  "for", "to", "and", "or", "why", "what", "who", "how", "is", "it", "its",
  "our", "was", "were", "with", "from", "about", "please",
]);

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9_./#-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .flatMap((t) => {
      if (t.startsWith("retr")) return [t, "retry", "retries"];
      if (t === "five" || t === "3") return [t, "three", "3"];
      return [t];
    });
}

const JUNK_PATH =
  /(node_modules|site-packages|dist-packages|__pypackages__|\.venv|\/venv\/|\.deno|deno-deck-venv|lib\/python\d)/i;

export function buildChunksBaseline(pack: RepoPack): Chunk[] {
  const chunks: Chunk[] = [];
  for (const file of pack.files) {
    if (JUNK_PATH.test(file.path)) continue;
    const lines = file.content.replace(/\n$/, "").split("\n");
    const size = 28;
    const step = 22;
    for (let start = 0; start < lines.length; start += step) {
      const slice = lines.slice(start, start + size);
      const startLine = start + 1;
      const endLine = start + slice.length;
      chunks.push({
        id: `${file.path}:${startLine}-${endLine}`,
        kind: "code",
        path: file.path,
        startLine,
        endLine,
        text: slice.join("\n"),
      });
      if (endLine >= lines.length) break;
    }
  }
  for (const commit of pack.commits) {
    chunks.push({
      id: `commit:${commit.sha}`,
      kind: "why",
      path: commit.files[0] ?? "git",
      startLine: 1,
      endLine: 1,
      text: `${commit.message}\n${commit.files.join(", ")}\nPR #${commit.pr ?? "—"} ${commit.author}`,
      sha: commit.sha,
      author: commit.author,
      date: commit.date,
      pr: commit.pr,
      message: commit.message,
    });
  }
  return chunks;
}

function termHits(hay: string, term: string): number {
  if (!term) return 0;
  const h = hay.toLowerCase();
  if (h.includes(term)) return 1 + (h.split(term).length - 1) * 0.35;
  return 0;
}

function namedPaths(query: string): string[] {
  return (query.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? []).map((p) => p.toLowerCase());
}

export function retrieveBaseline(query: string, chunks: Chunk[], limit = 6): Hit[] {
  const terms = tokenize(query);
  const named = namedPaths(query);
  if (terms.length === 0 && named.length === 0) return [];

  const q = query.toLowerCase();
  const wantsApi = /\bapi\b|endpoint|fastapi|flask|express|router/.test(q);
  const wantsWhat = /what does|what is|explain/.test(q);
  const floor = named.length > 0 || wantsApi ? 0.8 : 1.5;

  const scored: Hit[] = [];
  for (const chunk of chunks) {
    const path = chunk.path.toLowerCase();
    const base = path.split("/").pop() ?? path;
    const stem = base.replace(/\.[^.]+$/, "");
    const body = `${chunk.text} ${chunk.message ?? ""} ${chunk.pr ?? ""}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      score += 2.4 * termHits(path, term);
      score += 1.6 * termHits(body, term);
      if (term === stem || term === base) score += 4;
      if (chunk.kind === "why") score += 1.1 * termHits(body, term);
    }
    for (const name of named) {
      if (path.endsWith(name) || path.includes(`/${name}`) || base === name) score += 12;
    }
    if (wantsApi && /(?:^|\/)(api|main|app|server|router|client)(?:\/|\.[a-z]+$)/.test(path)) {
      score += 3.4;
    }
    if ((wantsWhat || named.length > 0) && chunk.startLine <= 8 && chunk.kind === "code") score += 1.6;
    const phrase = terms.join(" ");
    if (phrase && body.includes(phrase)) score += 2;
    if (score >= floor) scored.push({ ...chunk, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const hit of scored) {
    const key = hit.kind === "why" ? hit.id : hit.path;
    if (hit.kind === "code" && seen.has(key) && out.length >= 2) continue;
    if (hit.kind === "code") seen.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}
