/**
 * A citation chip already shows the file and line. The label is for provenance
 * — the PR or commit that put the line there — and nothing else. When the
 * material carries no history (a plain loaded folder), it stays empty so the
 * chip does not print the path twice.
 */
export function provenanceLabel(source: { pr?: string; sha?: string }): string {
  const bits = [source.pr ? `PR #${source.pr}` : "", source.sha ? source.sha.slice(0, 7) : ""];
  return bits.filter(Boolean).join(" · ");
}
