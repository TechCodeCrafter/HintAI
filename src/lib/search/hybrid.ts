/**
 * Structural / path / symbol retrieve — the third hybrid channel.
 * The async union lives on retrieve.ts `hybridRetrieve`.
 */
import type { Hit, IndexedChunk, ScoreBoosts } from "../repo/types.ts";
import { declaredSymbols, symbolKey } from "./query-symbols.ts";
import { RETRIEVAL_WEIGHTS } from "./retrieval-weights.ts";
import { knownTerms, nameCredit, namedPaths, tokenize } from "./retrieve.ts";

/**
 * The diversity cap on a ranked list: at most `max` chunks from any one file,
 * then the first `limit` of what is left.
 *
 * `ranked` must already be in score order. The list is walked once and a chunk
 * is either kept or dropped, so the order of the survivors is the order they
 * came in, both across files and within a file. A dropped chunk frees its slot
 * for the next file down, which is the point: on a three-file repo, a general
 * question used to come back as six README sections and nothing else.
 *
 * A file is a path within a source. Two sources that both store `README.md`
 * are two files.
 */
export function capPerFile<T extends Pick<Hit, "path">>(
  ranked: T[],
  limit: number,
  max: number = RETRIEVAL_WEIGHTS.maxChunksPerFile,
): T[] {
  const taken = new Map<string, number>();
  const out: T[] = [];
  for (const hit of ranked) {
    if (out.length >= limit) break;
    const source = "sourceId" in hit && typeof hit.sourceId === "string" ? hit.sourceId : "";
    const file = `${source}\u0000${hit.path}`;
    const used = taken.get(file) ?? 0;
    if (used >= max) continue;
    taken.set(file, used + 1);
    out.push(hit);
  }
  return out;
}

/**
 * The candidates one channel hands to the fusion step: its first `limit`, as
 * before, plus the chunks the cap would promote into those slots.
 *
 * Capping only the fused list is not enough. A channel that returns its top 12
 * can return 12 sections of one long README, and then the other files never
 * reach the fusion step for the cap to make room for them. The first `limit`
 * are kept as they were, so no chunk loses a channel score it used to have.
 */
export function candidatesForCap<T extends Pick<Hit, "path">>(ranked: T[], limit: number): T[] {
  const keep = new Set<T>([...ranked.slice(0, limit), ...capPerFile(ranked, limit)]);
  return ranked.filter((hit) => keep.has(hit));
}

export function retrieveStructural(query: string, chunks: IndexedChunk[], limit = 8): Hit[] {
  const named = namedPaths(query);
  const terms = tokenize(query);
  if (named.length === 0 && terms.length === 0) return [];
  // Window chunks carry no `symbol`, so without this the channel had no symbol
  // signal at all for them: only file names.
  const symbols = declaredSymbols(query, chunks);

  // Only needed when some file name matches, so it is worked out on first use.
  let known: Set<string> | null = null;
  const backable = (term: string) => ((known ??= knownTerms(terms, chunks)).has(term) ? 1 : 0);

  const scored: Hit[] = [];
  for (const chunk of chunks) {
    const path = chunk.path.toLowerCase();
    const base = path.split("/").pop() ?? path;
    const stem = base.replace(/\.[^.]+$/, "");
    const symbol = "symbol" in chunk && typeof chunk.symbol === "string" ? chunk.symbol.toLowerCase() : "";
    // Named addends for the search debug log. The score is their sum.
    const structuralBoosts: ScoreBoosts = {};
    let score = 0;
    const add = (name: string, value: number) => {
      if (value === 0) return;
      structuralBoosts[name] = (structuralBoosts[name] ?? 0) + value;
      score += value;
    };
    for (const name of named) {
      if (path.endsWith(name) || path.includes(`/${name}`) || base === name) add("namedPath", RETRIEVAL_WEIGHTS.pathMatch);
    }
    // Same rule as the lexical channel: a file name the chunk's text does not
    // back is a hint, and is scored as one.
    const stemKey = symbols.length > 0 ? symbolKey(stem) : "";
    const nameHit =
      terms.some((term) => term === stem || term === base) || symbols.some((asked) => asked.key === stemKey);
    const credit = nameHit ? nameCredit(terms, chunk, backable) : 1;
    for (const term of terms) {
      if (term === stem || term === base) add("fileName", credit * RETRIEVAL_WEIGHTS.filenameMatch);
      if (symbol && (term === symbol || symbol.includes(term))) add("symbolMatch", RETRIEVAL_WEIGHTS.symbolMatch);
    }
    for (const asked of symbols) {
      if (asked.chunks.has(chunk)) add("symbolDefinition", RETRIEVAL_WEIGHTS.symbolDefinition);
      // `answer-card.tsx` is the file of `AnswerCard`.
      if (asked.key === stemKey && !terms.some((term) => term === stem || term === base)) {
        add("symbolFile", credit * RETRIEVAL_WEIGHTS.filenameMatch);
      }
    }
    if (score > 0) scored.push({ ...chunk, score, structuralBoosts });
  }
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
