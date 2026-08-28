import type { RepoPack } from "@/lib/repo/types";

/**
 * Which part of a question a piece of evidence actually speaks to.
 *
 * A path match locates evidence; it does not make that evidence answerable. The
 * failure this module exists to close: "How are we testing the application?"
 * scored three points because the word "application" matched an `application/`
 * directory, and answered with a docstring about the Chain of Responsibility
 * pattern. The subject of the question — testing — appeared nowhere. The file was
 * in a relevant-looking place and said nothing relevant.
 *
 * So admission asks a different question from ranking. Ranking may keep using
 * every signal it has, path included. Admission asks whether the evidence
 * supports the part of the question that carries the meaning, and that is decided
 * by how discriminating each term is over the loaded material rather than by any
 * fixed list of weak words.
 */

/**
 * Tolerates inflection without a stemmer: "uploaded" should match `upload.py`
 * and "retrieval" should match `retrieve.ts`.
 */
export function mentions(haystack: string, term: string): boolean {
  if (haystack.includes(term)) return true;
  if (term.length < 6) return false;
  return haystack.includes(term.slice(0, Math.max(5, term.length - 3)));
}

/** Files that mention each term, the document frequency admission reasons over. */
const DF_CACHE = new WeakMap<RepoPack, Map<string, number>>();

export function fileFrequency(term: string, pack: RepoPack): number {
  let cache = DF_CACHE.get(pack);
  if (!cache) {
    cache = new Map();
    DF_CACHE.set(pack, cache);
  }
  const hit = cache.get(term);
  if (hit !== undefined) return hit;
  let df = 0;
  for (const file of pack.files) {
    if (mentions(`${file.path}\n${file.content}`.toLowerCase(), term)) df += 1;
  }
  cache.set(term, df);
  return df;
}

/**
 * The terms that carry the question's meaning.
 *
 * Discriminative weight is judged inside the question rather than against an
 * absolute cutoff, because "service" is generic in a repo full of services and
 * specific in one that has a single service. Terms at or below the median
 * document frequency are the subject; the common half is context. Ties keep both,
 * so a question whose terms are equally common asks for any of them and admission
 * does not tighten.
 */
export function subjectTerms(terms: string[], pack: RepoPack): string[] {
  // A term the material never uses cannot be the subject of an answer drawn from
  // it. Left in, it would be the rarest term of every question that contains it
  // and would make silence unconditional — "how does the export work?" in a repo
  // that says "workbook" is a question about the export, not about a missing word.
  const scored = terms.map((term) => ({ term, df: fileFrequency(term, pack) }));
  // A term more than half the material contains cannot indicate which part of it
  // answers. Dropping those first matters because the median below is taken over
  // whatever survives, and conversational filler is exactly what a relative
  // measure is vulnerable to: "we're not testing this at all, right?" carries
  // "not" and "all" in four files out of five, and left in they lift the median
  // far enough for a directory name to count as the subject.
  const known = scored.filter((item) => item.df > 0);
  if (known.length === 0) return [];
  const common = pack.files.length / 2;
  const discriminating = known.filter((item) => item.df <= common);
  // Only a demotion, never a way to strand the question with no subject at all.
  // In a handful of files everything is "common", and there the relative median
  // below is the only measure that means anything.
  const pool = discriminating.length > 0 ? discriminating : known;
  if (pool.length === 1) return [pool[0].term];
  const sorted = [...pool].sort((a, b) => a.df - b.df);
  const median = sorted[Math.floor((sorted.length - 1) / 2)].df;
  return pool.filter((item) => item.df <= median).map((item) => item.term);
}

/** Where a candidate's relevance came from, term by term. */
export type Provenance = {
  /** Question terms the evidence text itself mentions. */
  content: string[];
  /** Question terms only the file path mentions. */
  path: string[];
  /** The terms that carry the question's meaning. */
  subject: string[];
  /** Subject terms supported anywhere in the evidence. */
  covered: string[];
};

export function provenanceOf(
  terms: string[],
  subject: string[],
  claimText: string,
  claimPath: string,
): Provenance {
  const body = claimText.toLowerCase();
  const where = claimPath.toLowerCase();
  const content = terms.filter((term) => mentions(body, term));
  const path = terms.filter((term) => !content.includes(term) && mentions(where, term));
  const seen = new Set([...content, ...path]);
  return { content, path, subject, covered: subject.filter((term) => seen.has(term)) };
}

/**
 * Admission. At least one term carrying the question's meaning has to be
 * supported by the evidence — in its text or in the path naming what it
 * describes. A generic term colliding with a directory name is not support.
 *
 * Path support counts because it is often the honest answer: the docstring of
 * `bda-ingest-worker/` describes the BDA ingest worker without repeating its
 * name, and asking where upload is handled is answered by `upload.py`. What is
 * excluded is narrower and is the actual defect — evidence whose only tie to the
 * question is a low-information word.
 */
export function admissible(provenance: Provenance): boolean {
  if (provenance.subject.length === 0) return false;
  return provenance.covered.length > 0;
}

/** One line explaining an admission decision, for tracing and reports. */
export function explain(provenance: Provenance): string {
  const part = (label: string, terms: string[]) => `${label} ${terms.length ? terms.join("+") : "none"}`;
  return [
    part("content", provenance.content),
    part("path-only", provenance.path),
    part("subject", provenance.subject),
    part("subject-covered", provenance.covered),
  ].join(" | ");
}
