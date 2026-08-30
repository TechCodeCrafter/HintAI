import type { Citation, DocumentCitation, FileCitation, RepoPack } from "@/lib/repo/types";

/**
 * A file citation chip already shows the path and line. The label is for
 * provenance — the PR or commit that put the line there — and nothing else.
 * When the material carries no history (a plain loaded folder), it stays empty
 * so the chip does not print the path twice.
 */
export function provenanceLabel(source: { pr?: string; sha?: string }): string {
  const bits = [source.pr ? `PR #${source.pr}` : "", source.sha ? source.sha.slice(0, 7) : ""];
  return bits.filter(Boolean).join(" · ");
}

/**
 * How a citation reads. One implementation, because the rule this enforces is a
 * rule about the product and not about a particular pane: a chip states the
 * coordinates its evidence actually has, and a commit has no line.
 *
 *   file    docs/adr/0007-exporter-retries.md:8
 *   file    docs/adr/0007-exporter-retries.md:8-10
 *   commit  Commit a3f91c2 · PR #842
 */
export function citationText(cite: Citation): string {
  if (cite.kind === "commit") {
    return [`Commit ${cite.shortSha}`, cite.pr ? `PR #${cite.pr}` : ""].filter(Boolean).join(" · ");
  }
  if (cite.kind === "document") {
    const heading = cite.heading ? ` · "${cite.heading}"` : "";
    return `${cite.path} · Page ${cite.page}${heading}`;
  }
  const range = cite.endLine && cite.endLine > cite.line ? `${cite.line}-${cite.endLine}` : `${cite.line}`;
  return `${cite.path}:${range}`;
}

/** The file a citation opens, or nothing when it does not point into one. */
export function citedPath(cite: Citation): string | null {
  return cite.kind === "file" ? cite.path : null;
}

/** Narrowing helper for the panes that can only render file coordinates. */
export function isFileCitation(cite: Citation): cite is FileCitation {
  return cite.kind === "file";
}

/**
 * Document citations open PdfPane via Card evidence, never via citedPath().
 * Overlay hides RepoPane — keep the chip non-interactive there.
 * Relay has no source pane — render as text only.
 */
export function isDocumentCitation(cite: Citation): cite is DocumentCitation {
  return cite.kind === "document";
}

/**
 * The material behind a citation, for the offline harnesses that re-derive
 * support from what a Card cited. Deliberately mirrors the verifiable surface
 * the runtime gate uses, so the two cannot drift into disagreeing about what
 * counts as evidence for a commit.
 */
export function citedSource(cite: Citation, pack: Pick<RepoPack, "files" | "commits">): string {
  if (cite.kind === "document") return "";
  if (cite.kind === "file") return pack.files.find((f) => f.path === cite.path)?.content ?? "";
  const commit = pack.commits.find((c) => c.sha === cite.sha);
  return commit ? [commit.message, commit.author, commit.pr ?? ""].join("\n") : "";
}
