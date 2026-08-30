import type { NormalizedDocument } from "../document/types.ts";

/**
 * Exact token match plus forward inflection only.
 * "prevent" may match "prevents". "levels" must not match "level".
 */
export function documentMentions(haystack: string, term: string): boolean {
  const words = haystack.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.includes(term)) return true;
  return words.includes(`${term}s`) || words.includes(`${term}es`) || words.includes(`${term}ed`) || words.includes(`${term}ing`);
}

/**
 * Subject terms judged against PDF page text, not pack.files.
 * Filename matches are display metadata and do not count as evidence.
 */
export function documentSubjectTerms(terms: string[], documents: NormalizedDocument[]): string[] {
  const texts = documents.flatMap((document) => document.pages.map((page) => page.text.toLowerCase()));
  if (texts.length === 0 || terms.length === 0) return [];
  const scored = terms.map((term) => ({
    term,
    df: texts.filter((text) => documentMentions(text, term)).length,
  }));
  const known = scored.filter((item) => item.df > 0);
  if (known.length === 0) return [];
  const common = texts.length / 2;
  const discriminating = known.filter((item) => item.df <= common);
  const pool = discriminating.length > 0 ? discriminating : known;
  if (pool.length === 1) return [pool[0].term];
  const sorted = [...pool].sort((a, b) => a.df - b.df);
  const median = sorted[Math.floor((sorted.length - 1) / 2)].df;
  return pool.filter((item) => item.df <= median).map((item) => item.term);
}

/** The rarest subject terms must appear in the claim as exact tokens. */
/**
 * If most question content words never appear in the PDF corpus, a lock/table
 * lexical hit is not enough to speak.
 */
export function documentCorpusCoversQuestion(terms: string[], documents: NormalizedDocument[]): boolean {
  if (terms.length === 0) return false;
  const texts = documents.flatMap((document) => document.pages.map((page) => page.text.toLowerCase()));
  const known = terms.filter((term) => texts.some((text) => documentMentions(text, term))).length;
  const unknown = terms.length - known;
  return unknown === 0 || unknown < known;
}

export function documentClaimAdmissible(claim: string, subject: string[], documents: NormalizedDocument[]): boolean {
  if (subject.length === 0) return false;
  const texts = documents.flatMap((document) => document.pages.map((page) => page.text.toLowerCase()));
  const dfs = subject.map((term) => texts.filter((text) => documentMentions(text, term)).length);
  const min = Math.min(...dfs);
  const rarest = subject.filter((_, index) => dfs[index] === min);
  return rarest.some((term) => documentMentions(claim, term));
}
