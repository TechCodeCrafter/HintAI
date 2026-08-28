/**
 * Spoken-question normalization.
 *
 * The holdout proved that document frequency over a code corpus cannot identify
 * conversational filler — it inverts on it. "actually", "even" and "I mean" never
 * appear in Python, so a rarity measure ranks them as the most distinctive words
 * in the sentence: they blocked five real answers by becoming the subject, and in
 * one case supplied the answer themselves ("tests around this" found "a window
 * around the first matching token"). Rarity in code is not importance in speech,
 * and no amount of tuning the statistic fixes that, because the statistic is
 * measuring the wrong corpus.
 *
 * So the fix is language-level and sits before classification: strip the
 * scaffolding people speak around a question, keep every word that carries
 * technical meaning. This is deliberately not a stopword list. Each rule is
 * narrow, position-aware and auditable, and reports what it removed, because a
 * normalizer that silently eats a meaningful word is worse than filler.
 *
 * Two things it will not touch, both load-bearing elsewhere:
 *
 *   - Negation and existence words ("no", "not", "any", "at all", "anywhere").
 *     Absence detection reads these; removing them turns a challenge into a
 *     request for a description.
 *   - Trailing confirmation tags ("…, right?", "…, correct?"). They are the
 *     signal that a statement was a question, and `shapeOf` classifies a
 *     negative confirmation by them.
 */

export type Normalized = {
  /** Exactly what was heard. The transcript and the Card keep this. */
  raw: string;
  /** What classification, subject selection and retrieval should read. */
  canonical: string;
  /** Tokens dropped, in the order they were dropped. */
  removed: string[];
  /** Repairs applied, as "abandoned -> corrected". */
  repairs: string[];
};

/**
 * Words that open a spoken sentence without contributing to it. Closed class,
 * and only ever matched at the very start — "so" in "so that the job retries"
 * is doing real work and is never in leading position.
 */
const OPENERS = [
  "so", "ok", "okay", "alright", "all right", "well", "right", "now", "anyway", "anyways",
  "basically", "essentially", "honestly", "actually", "seriously", "look", "listen", "see",
  "yeah", "yep", "yes", "um", "umm", "uh", "uhh", "er", "erm", "hmm", "hmmm",
  "wait", "hold on", "and", "but", "then", "plus", "also",
  "i guess", "you know", "i mean", "quick question", "one question", "let me ask",
];

const LEADING = new RegExp(`^\\s*(?:${OPENERS.join("|")})\\b[\\s,;:—–-]*`, "i");

/** Markers that announce the speaker is correcting what they just said. */
const REPAIR = /[\s,—–-]*\b(?:actually,?\s+i\s+mean|i\s+mean|i\s+meant|sorry|or\s+rather|rather|scratch\s+that)\b[,:;]?\s*/i;

/** The interrogative head of a clause, used to rebuild a repaired question. */
const HEAD =
  /^\s*((?:where|what|which|who|whose|when|why|how)(?:'s|'re|s)?|does|do|did|is|are|was|were|can|could|should|would|will|has|have)\b/i;

/**
 * Adverbial hedges, each with the syntax that makes it a hedge rather than a
 * word. The guard is the point: "actually" between an auxiliary and a verb is
 * filler, while "the actual retry count" names a concept, and "around midnight"
 * is a time. Nothing is removed on the strength of the token alone.
 */
const HEDGES: Array<{ token: string; before: string; after?: string }> = [
  // "are we actually doing", "don't actually test", "…service.py actually do"
  { token: "actually", before: "do|does|did|is|are|was|were|am|be|been|being|we|you|they|it|i" },
  // "aren't really any tests", "does it really matter"
  { token: "really", before: "do|does|did|is|are|was|were|am|not|we|you|they|it|i" },
  // "do we even have", "is it even used" — but "even batches" keeps its adjective
  { token: "even", before: "do|does|did|is|are|was|were|have|has|had|we|you|they|it|i" },
  // "is just doing", "we just call"
  { token: "just", before: "is|are|was|were|am|be|been|being|we|you|they|it|i" },
  // "what basically happens" — mid-sentence, adverbial only
  { token: "basically", before: "what|how|why|where|it|we|they" },
  { token: "literally", before: "is|are|was|were|we|you|they|it" },
];

/**
 * Verbs common enough in speech that a hedge sitting directly in front of one is
 * adverbial regardless of what came before it: "…service.py actually do", "how
 * does the count actually work". Kept short and free of words that double as
 * nouns, so the rule stays a position test rather than a stopword list.
 */
const SPOKEN_VERBS =
  "do|does|did|doing|happen|happens|happened|work|works|working|get|gets|use|uses|using|used|call|calls|run|runs|handle|handles|write|writes|read|reads|store|stores|retry|retries|fail|fails|live|lives|go|goes|need|needs|talk|talks|know";

/** A hedge is removable in front of a verb, or behind the words in `before`. */
function hedgePattern(hedge: (typeof HEDGES)[number]): RegExp {
  // "n't" is matched without a leading boundary: there is none inside "don't".
  const left = `((?:\\b(?:${hedge.before})|n't)\\s+)${hedge.token}\\b`;
  const right = `(?:\\b${hedge.token}\\s+(?=(?:${hedge.after ?? SPOKEN_VERBS})\\b))`;
  return new RegExp(`${left}|${right}`, "gi");
}

/**
 * Words that cannot be the subject of a question about code, whatever a rarity
 * measure says about them. Three groups, and the reason each is here:
 *
 *   - Interrogatives, auxiliaries, determiners, pronouns and prepositions.
 *   - Light verbs. "Where are we doing the upload?" is asking about the upload;
 *     "doing" is how English attaches a speaker to a noun. Same for "own",
 *     "handle", "use", "work", "happen" — a code corpus almost never writes
 *     them, so document frequency mistakes them for the most distinctive word
 *     in the sentence, which is exactly how "doing" beat "upload".
 *   - Discourse words. The normalizer above removes these in the positions
 *     where they are provably filler; here they are barred from ever becoming a
 *     subject, because a hedge is never what the room is asking about.
 *
 * Meaningful qualifiers stay out of this list. "actual" is not here: "the actual
 * retry count" names a concept and dropping it would change the ask. Nor are the
 * existence words ("any", "at all") that carry negative-existence meaning.
 */
const NOT_A_SUBJECT = new Set(
  `what when where which how why who whose does do did doing done is are was were be been being
   have has had having the a an this that these those and or but for from with into about after before
   then there here it its our we you your they them their to of in on at by as
   can could should would will might must
   work works working worked happen happens happening handle handles handled handling
   use used uses using own owns owned owning make makes making made get gets getting got
   go goes going know knows mean means
   all any thing things stuff again though anymore
   actually really basically essentially literally honestly seriously even just also
   okay alright well right sorry yeah maybe guess`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * The words in a question that could plausibly name what it is about. Shared by
 * subject selection and the evaluation harnesses so they cannot drift apart.
 */
export function contentWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2 && !NOT_A_SUBJECT.has(word)),
    ),
  ];
}

/**
 * A vague preposition attaching the question to a bare pronoun: "tests around
 * this?", "anything about that?". The preposition carries no meaning there and
 * is rare enough in code to be picked as the subject — "tests around this" is
 * how the phrase "a window around the first matching token" became an answer.
 *
 * The pronoun must end the question. That is what separates this from "around
 * midnight" and "around this time", where the same word is a real qualifier.
 */
const VAGUE_ATTACHMENT = /\b(around|about)\s+(?=(?:this|that|it|these|those)\b\s*[?.!]*$)/gi;

function collapse(text: string): string {
  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:—–-]+/, "")
    .trim();
}

/** Does anything with meaning survive? Guards every removal below. */
function hasBody(text: string): boolean {
  return /[a-z0-9]/i.test(text) && text.trim().split(/\s+/).filter(Boolean).length > 0;
}

/**
 * Applies the explicit self-repair rules. "Where's the config — I mean the
 * template config?" keeps the interrogative head and the corrected phrase, and
 * the abandoned subject is dropped rather than added alongside it: feeding both
 * to subject selection is how "config" and "template config" would compete.
 */
function repair(text: string): { text: string; repairs: string[] } {
  const repairs: string[] = [];
  let current = text;
  for (let guard = 0; guard < 3; guard += 1) {
    const marker = REPAIR.exec(current);
    if (!marker || marker.index === 0) break;
    const left = current.slice(0, marker.index);
    const right = current.slice(marker.index + marker[0].length);
    if (!hasBody(right)) break;
    // A repair that restates its own interrogative needs no head borrowed from
    // the abandoned clause: "does the worker, sorry, does the ingest worker …".
    const rebuilt = HEAD.test(right) ? right : `${(HEAD.exec(left)?.[1] ?? "").trim()} ${right}`.trim();
    if (!hasBody(rebuilt)) break;
    repairs.push(`${collapse(left)} -> ${collapse(rebuilt)}`);
    current = rebuilt;
  }
  return { text: current, repairs };
}

export function normalizeSpokenQuestion(raw: string): Normalized {
  const removed: string[] = [];
  let text = raw.trim();

  // 1. Leading discourse markers, one at a time, never into the question body.
  for (let guard = 0; guard < 6; guard += 1) {
    const match = LEADING.exec(text);
    if (!match) break;
    const rest = text.slice(match[0].length);
    if (!hasBody(rest)) break;
    removed.push(match[0].trim().replace(/[\s,;:—–-]+$/, ""));
    text = rest;
  }

  // 2. Explicit self-repair, before hedges, so a hedge inside an abandoned
  //    fragment disappears with the fragment rather than being reported twice.
  const repaired = repair(text);
  text = repaired.text;

  // 3. Adverbial hedges, each only in the position that makes it filler.
  for (const hedge of HEDGES) {
    const pattern = hedgePattern(hedge);
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;
    const next = text.replace(pattern, (_whole, keep?: string) => keep ?? "");
    if (hasBody(next)) {
      removed.push(hedge.token);
      text = next;
    }
  }

  // 4. A vague preposition holding the question to a trailing pronoun.
  VAGUE_ATTACHMENT.lastIndex = 0;
  const vague = VAGUE_ATTACHMENT.exec(text);
  if (vague) {
    const trimmed = text.replace(VAGUE_ATTACHMENT, "");
    if (hasBody(trimmed)) {
      removed.push(vague[1].toLowerCase());
      text = trimmed;
    }
  }

  const canonical = collapse(text);
  return {
    raw,
    canonical: hasBody(canonical) ? canonical : raw.trim(),
    removed,
    repairs: repaired.repairs,
  };
}
