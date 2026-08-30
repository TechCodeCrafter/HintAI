import { reconstructSourceText } from "../document/source-text.ts";
import type { DocumentItemRange, NormalizedDocument } from "../document/types.ts";

/**
 * The canonical evidence model.
 *
 * A spoken line is only ever something the material already wrote, and this is
 * the record of exactly where that something lives. It exists because the two
 * things a Card promises — "these words are in your material" and "here is
 * where" — used to be enforced by different code with different notions of
 * where the claim came from. The citation was the start of the retrieved chunk,
 * a 28-line window, so the line number was approximately right and frequently
 * wrong; support was only ever checked offline, by a script, on a handful of
 * hand-picked questions.
 *
 * Evidence is a tagged union because the two sources MeetHint reads have
 * genuinely different coordinates, and flattening them is how fabricated
 * provenance gets in. A file has offsets and lines. A commit message has a sha,
 * an author and a date, and no line anywhere — it is not written *in* a file,
 * it is written *about* one. The union makes that difference impossible to
 * paper over: there is no `line` field on `CommitEvidence` to fill in with 1.
 * A PDF page is a third coordinate system — page + item ranges, never a fake
 * line — so it is a third member, not TextEvidence with sourceType "pdf".
 */

/** What kind of document text evidence was read from. */
export type SourceType = "code" | "markdown" | "text" | "pdf" | "docx" | "pptx" | "xlsx";

/**
 * Evidence that lives at a known position in a known document.
 *
 * Every coordinate here is measured, never estimated: offsets are half-open
 * into the source, lines are derived from those offsets so the two cannot
 * disagree, and `text` is exactly what that range holds.
 */
export type TextEvidence = {
  kind: "text";
  /** Stable within a pack: source, offsets, and the version hash. */
  id: string;
  /** The file path. */
  sourceId: string;
  sourceType: SourceType;
  path: string;

  /** 1-based and inclusive, counted in the source document, not the chunk. */
  startLine: number;
  endLine: number;

  /** Half-open, in the source document. `text` is exactly this range. */
  startOffset: number;
  endOffset: number;

  symbol?: string;

  /** Verbatim source. Never normalized, never re-wrapped, never trimmed of syntax. */
  text: string;
  /** The same evidence rendered for speech. This is what may be said. */
  normalizedText: string;

  /** Of the whole source document, so an edit anywhere invalidates the evidence. */
  contentHash: string;
};

/**
 * Evidence that lives in version history rather than in a file.
 *
 * A commit message has no offsets into anything the room can open, so this
 * carries the provenance that actually identifies it — sha, author, date, PR —
 * and nothing that pretends to be a location. `files` is the association the
 * commit itself records; it is what the change touched, not where the sentence
 * is, and it is never turned into a line number.
 */
export type CommitEvidence = {
  kind: "commit";
  id: string;
  /** The full sha. */
  sourceId: string;
  sha: string;
  shortSha: string;
  message: string;
  pr?: string;
  author?: string;
  date?: string;
  /** Paths the commit touched, when the material records them. */
  files?: string[];

  /** The message verbatim, so the support check reads the same field it verifies. */
  text: string;
  normalizedText: string;
  /** Of the message, so an amended or replaced commit is detectably different. */
  contentHash: string;
};

/**
 * Evidence that lives on a PDF page. No startLine/endLine — those are file
 * coordinates. Currentness reads cached NormalizedDocument items, not a reparse.
 */
/** Never includes DocumentBlock.id — blocks are derived structure, not provenance. */
export type DocumentEvidence = {
  kind: "document";
  id: string;
  sourceId: string;
  sourceType: "pdf";
  path: string;
  page: number;
  sourceText: string;
  supportText: string;
  spokenText: string;
  contentHash: string;
  parserVersion: number;
  normalizerVersion: number;
  itemRanges: DocumentItemRange[];
  boxes?: Array<{ page: number; x: number; y: number; w: number; h: number }>;
  heading?: string;
};

export type Evidence = TextEvidence | DocumentEvidence | CommitEvidence;

/**
 * cyrb53. Not cryptographic and not meant to be: this detects a source that
 * changed under evidence that was already built, where the adversary is a stale
 * index rather than a forger. 53 bits is far past what a loaded pack can
 * collide within, and it runs in the browser with no dependency.
 */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** 1-based line of an offset. */
export function lineAt(content: string, offset: number): number {
  const upto = content.slice(0, Math.max(0, Math.min(offset, content.length)));
  return upto.split("\n").length;
}

export function sourceTypeOf(path: string): SourceType {
  if (/\.(md|mdx|rst)$/i.test(path)) return "markdown";
  if (/\.(txt|log)$/i.test(path)) return "text";
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.docx?$/i.test(path)) return "docx";
  if (/\.pptx?$/i.test(path)) return "pptx";
  if (/\.xlsx?$/i.test(path)) return "xlsx";
  return "code";
}

/**
 * Builds text evidence over a half-open range of a document. Lines are derived
 * from the offsets rather than passed in, so they cannot disagree with the text.
 */
export function textEvidence(args: {
  path: string;
  content: string;
  start: number;
  end: number;
  normalizedText: string;
  symbol?: string;
  sourceType?: SourceType;
}): TextEvidence | null {
  const { path, content, normalizedText } = args;
  const start = Math.max(0, Math.min(args.start, content.length));
  const end = Math.max(start, Math.min(args.end, content.length));
  if (end <= start) return null;
  const text = content.slice(start, end);
  const contentHash = hashText(content);
  return {
    kind: "text",
    id: `${path}@${start}-${end}#${contentHash}`,
    sourceId: path,
    sourceType: args.sourceType ?? sourceTypeOf(path),
    path,
    startLine: lineAt(content, start),
    endLine: lineAt(content, end - 1),
    startOffset: start,
    endOffset: end,
    symbol: args.symbol,
    text,
    normalizedText,
    contentHash,
  };
}

/** The commit fields this model needs, as any pack records them. */
export type CommitSource = {
  sha: string;
  message: string;
  author?: string;
  date?: string;
  pr?: string;
  files?: string[];
};

/**
 * Builds commit evidence. Deliberately takes the whole commit rather than a
 * sha and a string: the author and the PR are the parts that make a commit
 * answerable for "who", and a model that drops them forces the composer to
 * reach around it for facts it should have been carrying.
 */
export function commitEvidence(commit: CommitSource, normalizedText: string): CommitEvidence {
  return {
    kind: "commit",
    id: `commit:${commit.sha}`,
    sourceId: commit.sha,
    sha: commit.sha,
    shortSha: commit.sha.slice(0, 7),
    message: commit.message,
    pr: commit.pr,
    author: commit.author,
    date: commit.date,
    files: commit.files,
    text: commit.message,
    normalizedText,
    contentHash: hashText(commit.message),
  };
}

/**
 * The two sources evidence can be checked against, supplied by whoever holds
 * the loaded material. Structural rather than a `RepoPack` so this module stays
 * below the repo types that reference it.
 */
export type SourceLookup = {
  file(path: string): string | undefined;
  commit(sha: string): { message: string } | undefined;
  document(sourceId: string): NormalizedDocument | undefined;
};

/**
 * True when text evidence still describes the document it was built from: the
 * version hash matches, and the recorded range still holds the recorded text.
 *
 * Both halves are load-bearing. The hash catches an edit anywhere in the file,
 * which is what makes evidence cached against an older pack detectably stale;
 * the range comparison catches evidence built against the wrong document
 * entirely.
 */
export function textIsCurrent(evidence: TextEvidence, content: string | undefined): boolean {
  if (content === undefined) return false;
  if (evidence.contentHash !== hashText(content)) return false;
  return content.slice(evidence.startOffset, evidence.endOffset) === evidence.text;
}

/**
 * True when commit evidence still matches the history as loaded.
 *
 * A commit is immutable in principle and mutable in practice — rebased,
 * amended, or simply absent from a pack that was reloaded from a shallower
 * clone. The message is hashed for the same reason a file is: so a sentence
 * quoted from a commit that no longer says it cannot be spoken.
 */
export function commitIsCurrent(
  evidence: CommitEvidence,
  commit: { message: string } | undefined,
): boolean {
  if (!commit) return false;
  return hashText(commit.message) === evidence.contentHash;
}

/** Verifies evidence against its own source, whichever kind it is. */
export function documentIsCurrent(
  evidence: DocumentEvidence,
  document: NormalizedDocument | undefined,
): boolean {
  if (!evidence.sourceId) return false;
  if (!document) return false;
  if (document.sourceId !== evidence.sourceId) return false;
  if (document.contentHash !== evidence.contentHash) return false;
  if (document.parserVersion !== evidence.parserVersion) return false;
  if (document.normalizerVersion !== evidence.normalizerVersion) return false;
  if (evidence.itemRanges.length === 0) return false;
  if (evidence.itemRanges.some((range) => range.page !== evidence.page)) return false;
  return reconstructSourceText(document, evidence.itemRanges) === evidence.sourceText;
}

export function evidenceIsCurrent(evidence: Evidence, sources: SourceLookup): boolean {
  if (evidence.kind === "text") return textIsCurrent(evidence, sources.file(evidence.path));
  if (evidence.kind === "document") return documentIsCurrent(evidence, sources.document(evidence.sourceId));
  return commitIsCurrent(evidence, sources.commit(evidence.sha));
}

/**
 * True when this evidence identifies a person, which is the only thing that can
 * answer "who". A commit message says what changed; the author field says who
 * changed it, and only the second one is authorship.
 */
export function establishesAuthorship(evidence: Evidence): boolean {
  return evidence.kind === "commit" && Boolean(evidence.author?.trim());
}

/**
 * Everything a piece of evidence can be held to.
 *
 * For a file that is the source text. For a commit it is the message plus the
 * provenance fields, because those are recorded facts about the commit and not
 * inferences from it: a Card that says "Jordan Lee, in PR #640" is quoting the
 * commit's author and PR as literally as one quoting its message. Nothing here
 * is derived or formatted — if a word is not in one of these fields, it is not
 * in the evidence.
 */
function verifiableText(evidence: Evidence): string {
  if (evidence.kind === "text") return evidence.text;
  if (evidence.kind === "document") return evidence.supportText;
  return [evidence.message, evidence.author ?? "", evidence.pr ?? "", evidence.sha].join("\n");
}

/**
 * Function words, and the fixed template words this codebase's compose paths
 * introduce. Everything outside this set has to come from the evidence.
 *
 * The second group is enumerated rather than inferred on purpose: each one is a
 * literal in a compose template — "Work is split across four workers" is built
 * from the file tree, not from prose — so the list is short, auditable, and
 * grows only when someone writes a new template and says so.
 */
export const GLUE = new Set([
  // Function words.
  "about", "above", "after", "again", "against", "along", "already", "also", "although",
  "always", "among", "another", "anything", "around", "because", "become", "becomes",
  "been", "before", "behind", "being", "below", "beneath", "beside", "between", "beyond",
  "both", "cannot", "could", "different", "does", "doing", "done", "during", "each",
  "either", "enough", "entire", "even", "every", "except", "further", "given", "gives",
  "hence", "here", "however", "immediately", "include", "included", "includes",
  "including", "inside", "instead", "into", "itself", "just", "keeps", "later", "least",
  "less", "letting", "like", "made", "make", "makes", "making", "many", "meant", "might",
  "more", "most", "much", "must", "neither", "never", "next", "none", "normally", "nothing",
  "often", "once", "only", "onto", "other", "others", "otherwise", "over", "overall",
  "particular", "perhaps", "rather", "really", "same", "several", "shall", "should",
  "similar", "simply", "since", "some", "someone", "something", "sometimes", "still",
  "such", "take", "taken", "takes", "than", "that", "their", "them", "themselves", "then",
  "there", "therefore", "these", "they", "thing", "things", "this", "those", "though",
  "through", "throughout", "thus", "together", "toward", "towards", "under", "until",
  "upon", "used", "uses", "using", "usually", "various", "very", "well", "were", "what",
  "when", "whenever", "where", "whether", "which", "while", "whole", "whose", "will",
  "with", "within", "without", "would", "your",
  // Words the compose templates supply themselves.
  "manages", "plus", "split", "work", "service", "across", "commit",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
]);

export type SupportCheck = {
  ok: boolean;
  /** Content words spoken that no cited evidence contains. */
  missing: string[];
  checked: number;
};

/** The words a support check is answerable for: long enough to carry meaning. */
function contentTokens(say: string): string[] {
  return [
    ...new Set(
      say
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.replace(/^[^a-z0-9_]+/, "").replace(/[^a-z0-9_]+$/, ""))
        .filter((w) => w.length > 4 && !GLUE.has(w)),
    ),
  ];
}

/**
 * The runtime support gate: every content word spoken must occur in evidence.
 *
 * This is the same check the offline harness has always run, moved to where it
 * can actually stop a Card. Each piece of evidence is read through its own
 * verifiable surface, so a claim from a commit is held to the commit and a
 * claim from a file is held to the file. `structural` carries vocabulary a
 * compose path drew from the file tree rather than from prose — directory and
 * framework names — and each caller passes its own, so the allowance is visible
 * at the call site instead of hidden in a global list.
 */
export function verifyClaim(
  say: string,
  evidence: Evidence[],
  structural: string[] = [],
): SupportCheck {
  const corpus = [...evidence.map(verifiableText), ...structural].join("\n").toLowerCase();
  const checked = contentTokens(say);
  const missing = checked.filter((word) => !corpus.includes(word));
  return { ok: missing.length === 0, missing, checked: checked.length };
}
