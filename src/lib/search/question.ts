import { normalizeSpokenQuestion } from "./spoken.ts";
import type { Reference, Resolution, ThreadContext } from "./thread.ts";
import { referenceIn, resolveReference, subjectCandidates } from "./thread.ts";

const LEAD =
  /^(what|why|who|how|where|when|which|whose|can we|can you|could we|could you|should we|does |do we|do you|did we|did you|is there|are there|is it|are we|tell me|walk me|explain|remind me)\b/i;

const ARTIFACT =
  /\[(?:BLANK_AUDIO|INAUDIBLE|MUSIC|NOISE|SILENCE|PAUSE|NOSPEECH)\]|<\|[^|>]+\|>|\bBLANK_AUDIO\b|\bINAUDIBLE\b/gi;

/**
 * Talk about the call itself. Matched anywhere in the utterance, because none of
 * these can appear inside a question about the material: nobody asks "where is
 * upload handled, and can you see my screen?".
 */
const LOGISTICS = new RegExp(
  [
    "can you hear me",
    "can you all hear",
    "(?:can|are) you (?:able to )?see (?:my|the|this) (?:screen|slide|deck|tab|window)",
    "can everyone (?:see|hear)",
    "(?:is|are) (?:everyone|everybody) (?:here|on|with us)",
    "are you there",
    "you still there",
    "next slide",
    "(?:should|shall|can|could) we (?:move on|move along|continue|proceed|jump ahead|skip ahead|get started|start|begin|wrap up|take a break)",
    "let'?s (?:move on|get started|start|begin|wrap up|take that offline)",
    "any (?:other )?questions",
    "(?:take|taking) (?:that|this|it) offline",
    "you'?re (?:on mute|muted)",
    "(?:i think )?you'?re muted",
    "(?:can you|could you) (?:repeat|say that again|say it again)",
    "who else (?:are we|is) (?:waiting|joining)",
    "(?:can|could) you speak up",
    "is my (?:audio|mic|video) (?:ok|okay|working|coming through)",
    "do you (?:mind if|want to) (?:i )?share",
    "(?:are|is) (?:we|this) recording",
  ].join("|"),
  "i",
);

/**
 * Social framing: greetings, thanks, "how are you".
 *
 * These may only match a whole clause, never a substring, and the distinction is
 * load-bearing. "How are you handling retries on the ingest worker?" contains
 * "how are you"; "thanks for that — why is the extraction in a container
 * lambda?" opens with "thanks for". Tested as substrings — which is what this
 * used to do — they silence one of the most ordinary shapes in an engineering
 * meeting, upstream of every layer that could otherwise recover it.
 *
 * Tails are bounded so a greeting cannot swallow the sentence behind it when the
 * transcript arrives without punctuation to split on.
 */
const FILLER = new RegExp(
  `^(?:${[
    "how are you(?: doing| today)?",
    "how'?s it going",
    "what'?s up",
    "what'?s new",
    "sorry",
    "sorry,? (?:what|say that)(?: again)?",
    "thanks",
    "thank you",
    "thanks for\\b[^?]{0,20}",
    "thank you for\\b[^?]{0,20}",
    "good (?:morning|afternoon|evening)(?: (?:everyone|all|team|folks))?",
    "(?:hello|hi|hey)(?: (?:there|everyone|all|team|folks))?",
    "nice to (?:meet|see) you(?: (?:all|too|again))?",
    // The tail is enumerated on purpose: "are we good on time?" is chatter,
    // "are we good on the schema migration?" is a question about the material.
    "(?:are )?we good(?: (?:on|for) (?:time|schedule|now))?",
    "all good(?: (?:on|for) (?:time|schedule|now))?",
  ].join("|")})[\\s,!.?]*$`,
  "i",
);

/** True when this stretch of speech is chatter rather than something asked. */
export function isChatter(text: string): boolean {
  return LOGISTICS.test(text) || FILLER.test(text);
}

/**
 * Clause boundaries a speaker audibly pauses at. Over-splitting is safe: only
 * clauses that are entirely filler are dropped, and what is left is rejoined.
 */
function clauses(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+|\s*[—–]\s*|\s+-\s+|,\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Removes social clauses and returns what the room was actually asked. Empty
 * means the whole utterance was framing.
 */
function stripFiller(text: string): string {
  const parts = clauses(text);
  const kept = parts.filter((part) => !FILLER.test(part));
  if (kept.length === parts.length) return text;
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

/** Generic technical vocabulary that earns retrieval even if the pack is small. */
const TECH =
  /\b(api|apis|endpoint|retry|retries|auth|authn|authz|authenticat\w*|authoriz\w*|login|session|token|cookie|database|db|sql|query|schema|migration|lambda|architect\w*|service|microservice|client|server|request|response|exporter|importer|queue|worker|job|cron|model|route|router|handler|controller|module|component|backend|frontend|deploy\w*|timeout|cache|caching|webhook|middleware|pipeline|ingest\w*|codebase|repo|repository|contract|clause|termination|liability|revenue|requirement|requirements|spec|sla|latency|throughput|rollback|failover|retention|encryption|permission|permissions|role|scope|tenant|webhooks|config|env|secret|credentials)\b/i;

/** Words common enough that overlap with the material proves nothing. */
const COMMON = new Set([
  "also", "back", "been", "both", "come", "could", "each", "even", "ever", "every",
  "find", "first", "give", "going", "good", "hear", "help", "here", "just", "keep",
  "kind", "know", "last", "left", "like", "look", "made", "make", "many", "mean",
  "more", "most", "much", "need", "next", "only", "other", "over", "part", "really",
  "right", "same", "says", "show", "some", "sort", "sure", "take", "tell", "than",
  "that", "their", "them", "then", "there", "these", "thing", "things", "think",
  "this", "those", "time", "used", "using", "very", "want", "well", "went", "were",
  "what", "when", "where", "which", "while", "will", "with", "work", "would", "your",
]);

const HALLUCINATION =
  /^(thank you\.?|thanks for watching\.?|thanks\.?|you\.?|bye\.?|the end\.?|okay\.?|ok\.?|hmm\.?|uh\.?|um\.?|see\.?|hello\.?|hi\.?|hey\.?|we'll be right back\.?|please subscribe\.?)$/i;

export type Gate = {
  /** Words the loaded material contains. See packVocabulary. */
  vocab?: Set<string>;
  /** True when a cited Card is already on screen, so follow-ups can be terse. */
  threadOpen?: boolean;
  /**
   * Structured state from the last answered question. Present, a reference in
   * the newest utterance can be resolved against it; absent, a referential
   * follow-up is silence rather than a guess.
   */
  thread?: ThreadContext | null;
};

/**
 * Whisper narrates non-speech audio as a parenthesised sound event — "(wind
 * blowing)", "(water splashing)", "[MUSIC PLAYING]". Room noise produces these
 * constantly, and they are never something the room said.
 */
const SOUND_EVENT = /[([][^)\]]{0,40}[)\]]/g;

export function cleanCaption(text: string): string {
  const cleaned = text
    .replace(ARTIFACT, " ")
    .replace(SOUND_EVENT, " ")
    .replace(/>>+/g, " ")
    .replace(/<<+/g, " ")
    .replace(/\bThey:\s*/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.:;>\-–—]+/, "")
    .trim();
  if (!cleaned || HALLUCINATION.test(cleaned)) return "";
  return cleaned;
}

/** Shape only: is this phrased as a question at all? */
export function looksLikeQuestion(text: string): boolean {
  const t = cleanCaption(text);
  if (t.length < 10) return false;
  if (isChatter(t)) return false;
  if (/[?]/.test(t)) return true;
  if (LEAD.test(t)) return true;
  return /\b(architecture|structured|overview|how (is|does) (this|the))\b/i.test(t);
}

export function extractQuestion(text: string): string {
  const clean = cleanCaption(text);
  const parts = clean.split(/(?<=[.?])\s+/);
  const asked = [...parts].reverse().find((p) => looksLikeQuestion(p));
  return (asked ?? clean).slice(0, 280);
}

export function isArchitectureQuery(query: string): boolean {
  return /architect|high[- ]level|system design|whole (app|application|system)|how (is|does) (this|the) (app|system|code|repo|application)|how is (this|it) (structured|built|organized)|overview of (the )?(app|system|codebase|application)/i.test(
    query,
  );
}

/**
 * Content words only. Deliberately not retrieval's tokenizer: that one expands
 * query synonyms, which would make overlap with the material easier to fake.
 */
function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? []).filter((w) => !COMMON.has(w));
}

/** Does the question share real words with the material that is loaded? */
function mentionsMaterial(text: string, vocab?: Set<string>): boolean {
  if (!vocab || vocab.size === 0) return false;
  return contentWords(text).some((word) => vocab.has(word));
}

/**
 * Decides only whether retrieval is worth attempting. It never decides the
 * answer — the Card still has to cite evidence or stay silent.
 */
export function isLiveQuestion(text: string, gate: Gate = {}): boolean {
  const t = cleanCaption(text);
  if (!looksLikeQuestion(t)) return false;
  if (isArchitectureQuery(t)) return true;
  if (mentionsMaterial(t, gate.vocab)) return true;
  if (TECH.test(t)) return true;
  if (/[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}/.test(t)) return true;
  if (
    /\b(this|that|the|our) (app|application|api|service|system|code|repo|backend|frontend|codebase|file|module|contract|doc|document|deck|design|flow|feature|change)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // A terse follow-up while a cited Card is up is still about the material.
  if (gate.threadOpen && t.length >= 12) return true;
  return false;
}

/**
 * Finds the most recent question anywhere in a stretch of transcript.
 *
 * Only for user-initiated Search, where "answer what was just asked" is the
 * whole point. It must never drive an automatic Card: it happily reaches back
 * past the newest utterance, so chatter would resurrect an answered question.
 * Automatic triggering goes through `gateNewest`.
 */
export function liveQuestionFromTranscript(text: string, gate: Gate = {}): string | null {
  const clean = cleanCaption(text);
  if (!clean) return null;
  const parts = clean.split(/(?<=[.?!])\s+/);
  for (const part of [...parts].reverse()) {
    if (isLiveQuestion(part, gate)) return extractQuestion(part);
  }
  if (isLiveQuestion(clean, gate)) return extractQuestion(clean);
  return null;
}

/**
 * A bare interrogative. Too short to pass the ordinary gate, and meaningless on
 * its own, but a real question when a cited Card is still on screen. The list is
 * closed on purpose: "yeah" and "okay" must never reach it.
 */
const TERSE =
  /^(why(\s+not)?|how(\s+(so|come))?|what|what\s+else|what\s+about\s+(that|it|this)|then\s+what|so\s+what|since\s+when|based\s+on\s+what|according\s+to\s+what)\b[\s,]*\??$/i;

export type GateVerdict =
  /** Nothing survived caption cleaning. */
  | "empty"
  /**
   * The same commit event arriving again with unchanged text — a re-emit, not a
   * second thing the room said. The only case where a line is ignored outright.
   */
  | "repeat-of-same-event"
  /** Meeting logistics. Never a Card, whatever came before it. */
  | "chatter"
  /** Not phrased as a question, or not about the loaded material. */
  | "not-a-question"
  /** A bare interrogative with no open thread to interpret it against. */
  | "orphan-follow-up"
  /**
   * The utterance points at something — "this service", "after that" — that the
   * open thread does not establish, or establishes more than once.
   */
  | "unresolved-reference"
  /** The newest utterance is a question in its own right. */
  | "question"
  /** The newest utterance is a question that needed context to resolve. */
  | "follow-up";

export type GateDecision = {
  candidateId: string;
  candidate: string;
  context: string[];
  verdict: GateVerdict;
  /** The query retrieval should run, or null for silence. */
  question: string | null;
  /** True when older utterances contributed words to `question`. */
  usedContext: boolean;
  /** How a reference in the utterance was grounded. Diagnostic only. */
  resolution?: Resolution;
};

/**
 * Decides whether the NEWEST utterance earns a Card.
 *
 * The invariant this exists to hold: an automatic Card is caused by the newest
 * eligible utterance and nothing else. Older utterances are allowed to help
 * interpret it — resolving "that" or standing behind a bare "Why?" — but they
 * can never trigger on their own. Once a question has been answered, it stays
 * answered; the chatter that follows it is silence.
 */
export function gateNewest(
  candidate: { id: string; text: string },
  context: string[],
  gate: Gate = {},
): GateDecision {
  const text = cleanCaption(candidate.text);
  const base: Omit<GateDecision, "verdict" | "question" | "usedContext"> = {
    candidateId: candidate.id,
    candidate: text,
    context,
  };
  const silent = (verdict: GateVerdict): GateDecision => ({
    ...base,
    verdict,
    question: null,
    usedContext: false,
  });

  if (!text) return silent("empty");
  // Checked before anything else: chatter is often a grammatical question, and
  // an open thread must not turn "can you hear me?" into a retrieval.
  if (isChatter(text)) return silent("chatter");
  // Social framing comes off clause by clause instead of silencing the line, so
  // a question survives the politeness in front of it. `base.candidate` keeps
  // the raw utterance: the diagnostic record shows what was said, not what was
  // gated on.
  const spoken = stripFiller(text);
  if (!spoken) return silent("chatter");

  // The most recent utterance that was itself a question is the only thing
  // allowed to lend meaning to a terse or referential follow-up.
  const prior = [...context].reverse().find((line) => isLiveQuestion(line, gate));

  // Structured state from the last answered question. `prior` is only used to
  // decide that the room was mid-thread; its text never travels into the query.
  const thread = gate.threadOpen ? (gate.thread ?? null) : null;

  const follow = (resolution: Resolution): GateDecision => {
    if (!resolution.question) return { ...silent("unresolved-reference"), resolution };
    return {
      ...base,
      verdict: "follow-up",
      question: resolution.question.slice(0, 280),
      usedContext: true,
      resolution,
    };
  };

  if (TERSE.test(spoken)) {
    if (!gate.threadOpen || !prior) return silent("orphan-follow-up");
    if (!thread) return silent("orphan-follow-up");
    return follow(resolveReference(normalizeSpokenQuestion(spoken).canonical, thread));
  }

  if (!isLiveQuestion(spoken, gate)) return silent("not-a-question");

  const asked = extractQuestion(spoken);
  const canonical = normalizeSpokenQuestion(asked).canonical;
  const reference = referenceIn(canonical);
  // A question earns its own trigger; context only resolves what it points at.
  // "what does this contract say about termination?" names its own subject and
  // must never be dragged toward the previous topic, so grounding is reserved
  // for utterances that have nothing left once the pointer is removed.
  if (reference && needsGrounding(canonical, reference)) {
    if (!thread) return { ...silent("unresolved-reference"), resolution: resolveReference(canonical, null) };
    return follow(resolveReference(canonical, thread));
  }
  return { ...base, verdict: "question", question: asked, usedContext: false };
}

/**
 * Is the pointer carrying the question, or does the utterance name a subject of
 * its own? "where is that stored?" is nothing without the thread; "what does the
 * worker retry after?" asks about retries and is left alone.
 *
 * A continuation has to be the whole utterance, because "after that, does the
 * worker retry?" is a real question and resolving it would throw the retry away.
 */
function needsGrounding(canonical: string, reference: Reference): boolean {
  return subjectCandidates(canonical.replace(reference.phrase, " ")).length === 0;
}
