import type { RepoPack } from "@/lib/repo/types";
import { filesHolding, haystackOf } from "./file-words.ts";

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

/**
 * What `mentions` looks for, as one search. A haystack that holds the term
 * also holds every prefix of it, so for a term of six letters or more the
 * shortened form alone decides; a shorter term has no shortened form.
 */
function needleOf(term: string): string {
  return term.length < 6 ? term : term.slice(0, Math.max(5, term.length - 3));
}

/**
 * Files that mention each term, the document frequency admission reasons over.
 * Kept per array of files: a pack copied to change its settings keeps the
 * array, and with it the counts.
 */
const DF_CACHE = new WeakMap<RepoPack["files"], Map<string, number>>();

/**
 * Counts, for every term not counted yet, the files that mention it.
 *
 * Once the files' words are indexed (`file-words.ts`) each count is a lookup.
 * Until then, and for a term the index cannot answer, it is one pass over the
 * files for all of those terms together: each file's text is lowered once and
 * searched once per term. Both give the same number.
 */
function countFiles(terms: string[], pack: RepoPack): Map<string, number> {
  let cache = DF_CACHE.get(pack.files);
  if (!cache) {
    cache = new Map();
    DF_CACHE.set(pack.files, cache);
  }
  const fresh = [...new Set(terms)].filter((term) => !cache.has(term));
  if (fresh.length === 0) return cache;
  const unread: string[] = [];
  for (const term of fresh) {
    const held = filesHolding(pack.files, needleOf(term));
    if (held === null) unread.push(term);
    else cache.set(term, held);
  }
  if (unread.length === 0) return cache;
  const needles = unread.map(needleOf);
  const counts = new Array<number>(unread.length).fill(0);
  for (const file of pack.files) {
    const haystack = haystackOf(file);
    for (let i = 0; i < needles.length; i += 1) {
      if (haystack.includes(needles[i])) counts[i] += 1;
    }
  }
  for (let i = 0; i < unread.length; i += 1) cache.set(unread[i], counts[i]);
  return cache;
}

export function fileFrequency(term: string, pack: RepoPack): number {
  return countFiles([term], pack).get(term) ?? 0;
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
  const counted = countFiles(terms, pack);
  const scored = terms.map((term) => ({ term, df: counted.get(term) ?? 0 }));
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
