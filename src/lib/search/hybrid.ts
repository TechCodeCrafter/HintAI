/**
 * Structural / path / symbol retrieve — the third hybrid channel.
 * The async union lives on retrieve.ts `hybridRetrieve`.
 */
import type { Hit, IndexedChunk } from "../repo/types.ts";
import { RETRIEVAL_WEIGHTS } from "./retrieval-weights.ts";
import { knownTerms, nameCredit, namedPaths, tokenize } from "./retrieve.ts";

export function retrieveStructural(query: string, chunks: IndexedChunk[], limit = 8): Hit[] {
  const named = namedPaths(query);
  const terms = tokenize(query);
  if (named.length === 0 && terms.length === 0) return [];

  // Only needed when some file name matches, so it is worked out on first use.
  let known: Set<string> | null = null;
  const backable = (term: string) => ((known ??= knownTerms(terms, chunks)).has(term) ? 1 : 0);

  const scored: Hit[] = [];
  for (const chunk of chunks) {
    const path = chunk.path.toLowerCase();
    const base = path.split("/").pop() ?? path;
    const stem = base.replace(/\.[^.]+$/, "");
    const symbol = "symbol" in chunk && typeof chunk.symbol === "string" ? chunk.symbol.toLowerCase() : "";
    let score = 0;
    for (const name of named) {
      if (path.endsWith(name) || path.includes(`/${name}`) || base === name) score += RETRIEVAL_WEIGHTS.pathMatch;
    }
    // Same rule as the lexical channel: a file name the chunk's text does not
    // back is a hint, and is scored as one.
    const nameHit = terms.some((term) => term === stem || term === base);
    const credit = nameHit ? nameCredit(terms, chunk, backable) : 1;
    for (const term of terms) {
      if (term === stem || term === base) score += credit * RETRIEVAL_WEIGHTS.filenameMatch;
      if (symbol && (term === symbol || symbol.includes(term))) score += RETRIEVAL_WEIGHTS.symbolMatch;
    }
    if (score > 0) scored.push({ ...chunk, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
