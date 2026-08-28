import type { Chunk, Hit, RepoPack } from "@/lib/repo/types";

const STOP = new Set([
  "a",
  "an",
  "the",
  "that",
  "this",
  "does",
  "did",
  "do",
  "we",
  "you",
  "in",
  "of",
  "for",
  "to",
  "and",
  "or",
  "why",
  "what",
  "who",
  "how",
  "is",
  "it",
  "its",
  "our",
  "was",
  "were",
  "with",
  "from",
  "about",
  "please",
  // Function words that carry no retrieval signal but do collide with code.
  // "out" is the worst offender: it used to substring-match every "route".
  "where",
  "when",
  "which",
  "can",
  "could",
  "should",
  "would",
  "will",
  "are",
  "am",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "not",
  "but",
  "if",
  "then",
  "than",
  "also",
  "any",
  "all",
  "some",
  "more",
  "most",
  "much",
  "many",
  "very",
  "really",
  "actually",
  "just",
  "out",
  "up",
  "into",
  "over",
  "again",
  "still",
  "now",
  "here",
  "there",
  "these",
  "those",
  "they",
  "them",
  "their",
  "us",
  "me",
  "my",
  "your",
  "because",
  "while",
]);

const DIGIT_WORD: Record<string, string> = {
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
  "10": "ten",
};
const WORD_DIGIT: Record<string, string> = Object.fromEntries(
  Object.entries(DIGIT_WORD).map(([digit, word]) => [word, digit]),
);

export function tokenize(q: string): string[] {
  const raw = q
    .toLowerCase()
    .replace(/[^a-z0-9_./#-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

  const out: string[] = [];
  for (const term of raw) {
    out.push(term);
    // "three" and "3" should find each other; nothing else should alias.
    const alias = DIGIT_WORD[term] ?? WORD_DIGIT[term];
    if (alias) out.push(alias);
    // Whisper writes "re-try" and "auto-answer"; index the joined form too.
    if (term.includes("-")) {
      const joined = term.replace(/-/g, "");
      if (joined.length > 2) out.push(joined);
    }
  }
  return [...new Set(out)];
}

const JUNK_PATH =
  /(node_modules|site-packages|dist-packages|__pypackages__|\.venv|\/venv\/|\.deno|deno-deck-venv|lib\/python\d)/i;

/**
 * Machine-written files. They are real files and stay visible in the tree, but
 * they are not evidence: nobody asks a question whose answer is a generated
 * route table, and their repetitive contents used to dominate scoring.
 */
const GENERATED_PATH =
  /(^|\/)(dist|build|out|coverage|vendor|__generated__|generated|\.next|\.turbo|\.cache|__snapshots__)\/|\.(gen|generated)\.[a-z]+$|\.d\.ts$|\.min\.(js|css)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|composer\.lock)$|\.snap$/i;

/**
 * Deploy output and agent/editor tooling are not the user's material. Citing
 * `.vercel/output` or `.grok/skills` is never a defensible answer about a repo.
 */
const TOOLING_PATH = /(^|\/)\.[A-Za-z0-9_-]+\//;

export function isEvidencePath(path: string): boolean {
  return !JUNK_PATH.test(path) && !GENERATED_PATH.test(path) && !TOOLING_PATH.test(path);
}

export function buildChunks(pack: RepoPack): Chunk[] {
  const chunks: Chunk[] = [];
  for (const file of pack.files) {
    if (!isEvidencePath(file.path)) continue;
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

const VOCAB_CHUNKS = 3000;
const VOCAB_MAX = 24000;

function vocabWords(source: string): string[] {
  return (
    source
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[a-z][a-z0-9]{2,}/g) ?? []
  );
}

/**
 * The set of words the loaded material actually contains. The question gate uses
 * this instead of a fixed keyword list, so a question earns retrieval by
 * overlapping with the material rather than by sounding technical.
 */
export function packVocabulary(chunks: Chunk[]): Set<string> {
  const vocab = new Set<string>();
  const scan = chunks.length > VOCAB_CHUNKS ? chunks.slice(0, VOCAB_CHUNKS) : chunks;
  for (const chunk of scan) {
    for (const word of vocabWords(chunk.path)) {
      if (vocab.size >= VOCAB_MAX) return vocab;
      vocab.add(word);
    }
    for (const word of vocabWords(chunk.text)) {
      if (vocab.size >= VOCAB_MAX) return vocab;
      vocab.add(word);
    }
    if (chunk.message) {
      for (const word of vocabWords(chunk.message)) {
        if (vocab.size >= VOCAB_MAX) return vocab;
        vocab.add(word);
      }
    }
  }
  return vocab;
}

/**
 * Split identifiers and punctuation into words, so "buildChunks" matches the
 * term "chunks" while "route" no longer matches the term "out".
 */
function toWords(source: string): string[] {
  return source
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Light suffix stripping so "retrieval" reaches "retrieve" and "captions"
 * reaches "caption". Deliberately shallow: aggressive stemming collides more
 * than it helps on identifier-heavy text.
 */
function stemOf(word: string): string {
  const cut = word.replace(/(ational|ization|ations|ition|ment|ness)$/, "").replace(/(ing|ed|es|s|al|ly)$/, "");
  const base = cut.length >= 3 ? cut : word;
  return base.endsWith("e") && base.length > 3 ? base.slice(0, -1) : base;
}

type Indexed = {
  path: string;
  base: string;
  stem: string;
  pathWords: Map<string, number>;
  bodyWords: Map<string, number>;
};

function tally(words: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const word of words) {
    map.set(word, (map.get(word) ?? 0) + 1);
    const stem = stemOf(word);
    if (stem !== word) map.set(`~${stem}`, (map.get(`~${stem}`) ?? 0) + 1);
  }
  return map;
}

const INDEX = new WeakMap<Chunk, Indexed>();

function indexOf(chunk: Chunk): Indexed {
  const cached = INDEX.get(chunk);
  if (cached) return cached;
  const path = chunk.path.toLowerCase();
  const base = path.split("/").pop() ?? path;
  const built: Indexed = {
    path,
    base,
    stem: base.replace(/\.[^.]+$/, ""),
    pathWords: tally(toWords(chunk.path)),
    bodyWords: tally(toWords(`${chunk.text} ${chunk.message ?? ""} ${chunk.pr ?? ""}`)),
  };
  INDEX.set(chunk, built);
  return built;
}

/** Bounded term frequency: repetition helps, but cannot run away. */
function sat(tf: number): number {
  return tf <= 0 ? 0 : (tf * 2.2) / (tf + 1.2);
}

function freq(words: Map<string, number>, term: string): number {
  const exact = words.get(term) ?? 0;
  const stem = words.get(`~${stemOf(term)}`) ?? 0;
  return exact + 0.5 * stem;
}

/**
 * Inverse document frequency over the loaded material, so a term that appears
 * in half the repo ("gate", "store", "client") cannot outrank the term that
 * actually identifies the subject.
 */
function idfMap(terms: string[], chunks: Chunk[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    const idx = indexOf(chunk);
    for (const term of terms) {
      if (freq(idx.bodyWords, term) > 0 || freq(idx.pathWords, term) > 0) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
  }
  const n = Math.max(1, chunks.length);
  const out = new Map<string, number>();
  for (const term of terms) {
    out.set(term, Math.log(1 + n / (1 + (df.get(term) ?? 0))));
  }
  return out;
}

export function namedPaths(query: string): string[] {
  return (query.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? []).map((p) => p.toLowerCase());
}

const MAX_PER_FILE = 3;
const MAX_PER_FILE_KIND = 2;

export function retrieve(query: string, chunks: Chunk[], limit = 6): Hit[] {
  const terms = tokenize(query);
  const named = namedPaths(query);
  if (terms.length === 0 && named.length === 0) return [];

  const q = query.toLowerCase();
  const wantsApi = /\bapi\b|endpoint|fastapi|flask|express|router/.test(q);
  // A structural question is answered by the shape of the repo, so it retrieves
  // entry points and file heads. Kept deliberately narrow: the old blanket
  // "what is" bias boosted the head of every file and pinned citations to line 1.
  const wantsShape =
    /\barchitecture\b|\bstructure\b|\boverview\b|how is (?:this|the|it) (?:built|organized|structured)|what does (?:this|the) (?:app|application|service|project|repo|codebase) do/.test(
      q,
    );
  const idf = idfMap(terms, chunks);

  const scored: Hit[] = [];
  for (const chunk of chunks) {
    const idx = indexOf(chunk);
    let score = 0;
    for (const term of terms) {
      const weight = idf.get(term) ?? 1;
      score += weight * 2.4 * sat(freq(idx.pathWords, term));
      score += weight * 1.6 * sat(freq(idx.bodyWords, term));
      if (term === idx.stem || term === idx.base) score += weight * 4;
      if (chunk.kind === "why") score += weight * 1.1 * sat(freq(idx.bodyWords, term));
    }
    for (const name of named) {
      if (idx.path.endsWith(name) || idx.path.includes(`/${name}`) || idx.base === name) score += 12;
    }
    if (
      (wantsApi || wantsShape) &&
      /(?:^|\/)(api|main|app|index|server|router|client|store)(?:\/|\.[a-z]+$)/.test(idx.path)
    ) {
      score += 3.4;
    }
    if ((named.length > 0 || wantsShape) && chunk.startLine <= 8 && chunk.kind === "code") {
      score += 1.6;
    }
    if (score > 0) scored.push({ ...chunk, score });
  }
  if (scored.length === 0) return [];

  // Rank files by their best chunk, with a modest bonus for corroborating
  // chunks, then draw from files in order so one file cannot flood the top.
  const byFile = new Map<string, Hit[]>();
  for (const hit of scored) {
    const list = byFile.get(hit.path);
    if (list) list.push(hit);
    else byFile.set(hit.path, [hit]);
  }

  const files = [...byFile.entries()].map(([path, hits]) => {
    const sorted = hits.sort((a, b) => b.score - a.score);
    const best = sorted[0].score;
    const rest = sorted.slice(1).reduce((sum, h) => sum + h.score, 0);
    return { path, hits: sorted, score: best + Math.min(0.5 * best, 0.2 * rest) };
  });
  files.sort((a, b) => b.score - a.score);

  const top = files[0].score;
  const floor = Math.max(named.length > 0 || wantsApi ? 0.6 : 1.0, top * 0.12);

  const out: Hit[] = [];
  const takenPerFile = new Map<string, number>();
  const takenPerKind = new Map<string, number>();
  for (let round = 0; round < MAX_PER_FILE && out.length < limit; round += 1) {
    for (const file of files) {
      if (out.length >= limit) break;
      const used = takenPerFile.get(file.path) ?? 0;
      if (used > round) continue;
      const next = file.hits.find((h) => {
        const kindKey = `${h.path}|${h.kind}`;
        return (
          !out.includes(h) &&
          h.score >= floor &&
          (takenPerKind.get(kindKey) ?? 0) < MAX_PER_FILE_KIND
        );
      });
      if (!next) continue;
      out.push(next);
      takenPerFile.set(file.path, used + 1);
      const kindKey = `${next.path}|${next.kind}`;
      takenPerKind.set(kindKey, (takenPerKind.get(kindKey) ?? 0) + 1);
    }
  }
  // Diversity decides which chunks survive; score decides how they rank.
  return out.sort((a, b) => b.score - a.score);
}

export function lineInFile(pack: RepoPack, path: string, needle: string): number {
  const file = pack.files.find((f) => f.path === path);
  if (!file) return 1;
  const lines = file.content.split("\n");
  const idx = lines.findIndex((l) => l.includes(needle));
  return idx >= 0 ? idx + 1 : 1;
}
