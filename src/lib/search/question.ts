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
    // Asked of whoever is driving the screen, not of the material.
    "(?:can|could|would) you (?:please |just )?(?:scroll (?:up|down|back)|zoom (?:in|out)|go back(?: a (?:slide|page))?|click (?:on|that|this)|share your screen|switch (?:tabs|windows|screens)|make (?:it|that) (?:bigger|larger|full ?screen))",
    "what time is it",
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
    // A check that the room is following. Asked of the people, not of the
    // material, and a whole clause only: "does that make sense given the retry
    // limit?" keeps its tail and is judged on it.
    "(?:does|did) that make sense",
    "(?:that )?make sense",
    "(?:does|is) that (?:sound |seem |look )?(?:right|correct|clear|fair|fine|good|ok|okay|reasonable)",
    "what do you (?:all |guys )?(?:think|reckon)(?: (?:of|about) (?:it|that|this))?",
    "any thoughts",
    "(?:do|would) you (?:all )?agree",
    "right",
    "you know(?: what i mean)?",
    "does that answer (?:your|the) question",
    "(?:are )?you with me",
    "(?:so )?(?:is|was) that (?:it|all)",
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
  // Function words long enough to pass the length filter. One of them shared
  // with a file ("before extraction runs") says nothing about the question.
  "about", "after", "again", "always", "because", "before", "being", "between", "does",
  "doing", "done", "during", "from", "have", "having", "into", "never", "onto", "should",
  "since", "still", "today", "tomorrow", "until", "without", "yesterday",
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

/**
 * A question word opening a statement. "When we deployed the API it broke" and
 * "What we need is a queue" both start like questions and ask nothing: after
 * the question word comes a subject, where a question has a verb.
 */
const DECLARATIVE_LEAD =
  /^(?:(?:when|where|what|how|why|who)\s+(?:i|we|you|they|he|she|it|the|a|an|this|that|these|those|my|our|your|their)\b|which\s+(?:is|was)\s+(?:why|what|how|where|when)\b|which\s+(?:means|meant|makes|made)\b)/i;

/** Do-support or a modal in front of a subject: the mark of a question asked later in the line. */
const INVERSION =
  /\b(?:does|do|did|can|could|should|would|will)\s+(?:i|we|you|they|it|there|the|this|that|these|those|our|your|a|an)\b/i;

/** A request for the big picture that is not phrased with a question word. */
const OVERVIEW_REQUEST =
  /\b(?:give|show|share|get|want|need|like|love|hear|see|start with|go over|go through|run through|talk through)\b[^.?!]{0,60}\b(?:architecture|overview|high[- ]level)\b|\bhow (?:is|does) (?:this|the)\b/i;

/**
 * True when the line opens with a question word and is a statement anyway.
 * Only read when the line has no "?": a question mark is the speaker's own
 * word on the matter.
 */
function opensAsStatement(text: string): boolean {
  if (!DECLARATIVE_LEAD.test(text)) return false;
  // "When you deploy, does the cache reset" asks its question in the second half.
  return !INVERSION.test(text.replace(DECLARATIVE_LEAD, " "));
}

/** Words a finished question does not end on. */
const DANGLING = new Set(["the", "an", "my", "our", "your", "their", "and", "but", "because", "if", "um", "uh", "er", "erm"]);

/**
 * True when the line stops before it has asked anything: "What is the?", "So
 * how does the...", "Why does it retry and". A clip cut short by a pause comes
 * out like this, often with a "?" the transcriber added, so the question mark
 * does not excuse it. Prepositions are not on the list: "what is this used
 * for?" and "which file is that in?" are whole questions.
 */
export function trailsOff(text: string): boolean {
  const t = text.trim();
  if (/(?:\.{2,}|\u2026|[-\u2013\u2014])$/.test(t)) return true;
  const last = /([A-Za-z']+)[\s,?.!]*$/.exec(t)?.[1];
  if (!last) return false;
  // Lowercase only: "should we go with option A?" ends on a name.
  return last === "a" || DANGLING.has(last.toLowerCase());
}

/** Shape only: is this phrased as a question at all? */
export function looksLikeQuestion(text: string): boolean {
  const t = cleanCaption(text);
  if (t.length < 10) return false;
  if (isChatter(t)) return false;
  if (/[?]/.test(t)) return true;
  if (LEAD.test(t)) return !opensAsStatement(t);
  return OVERVIEW_REQUEST.test(t);
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
 * Every word a question about the app as a whole can be made of: the asking,
 * a noun for the app, and a word for its shape. Anything else is a subject of
 * its own ("retry", "session", "exporter").
 */
const WHOLE_APP_WORDS = new Set([
  // asking
  "a", "an", "the", "this", "that", "it", "its", "is", "are", "was", "be", "does", "do", "did",
  "can", "could", "would", "will", "you", "your", "me", "my", "we", "us", "our", "i", "please",
  "tell", "give", "show", "explain", "describe", "walk", "talk", "take", "through", "about",
  "of", "in", "on", "at", "to", "for", "and", "or", "so", "just", "like", "kind", "sort",
  "quick", "quickly", "brief", "briefly", "short", "summary", "summarize", "what", "whats", "s", "how",
  // the app
  "app", "application", "system", "code", "codebase", "repo", "repository", "project", "service",
  "product", "platform", "tool", "software", "api",
  // its shape
  "architecture", "architectural", "design", "designed", "structure", "structured", "built", "build",
  "organized", "organised", "laid", "out", "layout", "overview", "work", "works", "working",
  "fit", "fits", "together", "set", "up", "setup", "put", "made", "high", "level", "whole",
  "entire", "overall", "general", "big", "picture", "top", "main", "components", "parts", "pieces",
  "stack", "tech", "technical",
]);

/**
 * True when the question has no subject of its own: it is about the app as a
 * whole. "How does this app work?" is. "How does the app retry failed exports?"
 * is a question about retries that happens to say "the app".
 *
 * This is the gate on the README and entry-point boost. It is an allowlist on
 * purpose: an unknown word means the question goes to ordinary retrieval, which
 * can still land on the README when the README is where the answer is.
 * `names` are extra words that mean the app itself, such as the pack's name.
 */
export function asksAboutWholeApp(query: string, names: string[] = []): boolean {
  const own = new Set(names.flatMap((name) => name.toLowerCase().match(/[a-z0-9]+/g) ?? []));
  const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.length > 0 && words.every((word) => WHOLE_APP_WORDS.has(word) || own.has(word));
}

/**
 * "Tell me about the project" asks what the repo is, not for whichever file
 * happens to contain the word "project". The noun has to be the whole question.
 * "What is this project's terraform" is a different question and must not match.
 */
export function isProjectOverviewQuery(query: string): boolean {
  const q = query.trim().replace(/[?!.]+$/g, "").trim();
  return /^(?:(?:can|could|would) you |please )?(?:tell me about|what(?: is|'s)|what does|how does|describe|explain|walk me through|give me (?:an? )?overview of) (?:this |the |our )?(?:project|repo|repository|codebase|application|app|service|system)(?: do| work| about)?$/i.test(
    q,
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
  return whyNotLive(text, gate) === null;
}

/** "What about the error handling?": a new subject asked against the open thread. */
const THREAD_LEAD = /^(?:and\s+|so\s+|ok(?:ay)?\s+)?(?:what|how)\s+about\b/i;

const CALENDAR_POINTER =
  /\b(?:this|that|these|those)\s+(?:week|weekend|morning|afternoon|evening|month|year|quarter|meeting|call|time)\b/gi;
const WH_FOLLOW = /^(?:(?:and|so|but|ok|okay)\s+)?(?:why|how|what|where|when|which|who)\b/i;
const TO_THE_ROOM = /\b(?:you|your|yours|everyone|everybody|anyone|anybody|guys|folks)\b/i;

/**
 * Why a line does not earn a search, as one sentence, or null when it does.
 * The sentence is what the rejection log shows.
 */
export function whyNotLive(text: string, gate: Gate = {}): string | null {
  const t = cleanCaption(text);
  if (!looksLikeQuestion(t)) {
    if (t.length < 10) return "Too short to be a question.";
    if (isChatter(t)) return "Talk about the meeting, not about the material.";
    if (LEAD.test(t)) return "Opens with a question word but is a statement.";
    return "Not phrased as a question.";
  }
  return aboutMaterial(t, gate) ? null : "A question, but not about the loaded material.";
}

function aboutMaterial(t: string, gate: Gate): boolean {
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
  // A follow-up while a cited Card is up is about the material when it is
  // nothing without that Card ("where is that stored?") or asks about
  // something next to it ("what about the error handling?"). Any other
  // question in the room is not made a follow-up by the Card being there:
  // "who wants to go first?" points at nothing, and "what are you doing this
  // weekend?" has a subject of its own.
  if (gate.threadOpen && t.length >= 12) {
    const canonical = normalizeSpokenQuestion(t).canonical;
    if (THREAD_LEAD.test(canonical)) return true;
    // "This weekend" and "this meeting" point at the calendar, not the Card.
    const rest = canonical.replace(CALENDAR_POINTER, " ");
    const reference = referenceIn(rest);
    // With the calendar taken out, "what is this meeting for?" is a bare
    // "what is for?", which points at nothing.
    if (!reference || (rest !== canonical && reference.kind === "terse")) return false;
    if (needsGrounding(rest, reference)) return true;
    // "And why that number?" names a thing and still leans on the Card. It
    // has to be an information question, and not one put to the people.
    return WH_FOLLOW.test(canonical) && !TO_THE_ROOM.test(canonical);
  }
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

/**
 * Speech a line needs behind it before it may open a search on its own. A line
 * that carries a "?" is exempt: the question mark is explicit.
 */
export const MIN_SPEECH_MS = 1200;

const CHATTER_REASON = "Talk about the meeting, not about the material.";

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
  /** No "?" and less than MIN_SPEECH_MS of speech behind it. */
  | "too-short"
  /** The line stops before it has asked anything. */
  | "incomplete"
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
  /** Why the utterance was turned away, as one sentence. Null when it was not. */
  reason: string | null;
  /** Speech measured behind the utterance, when the listening path measured it. */
  speechMs?: number;
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
  candidate: { id: string; text: string; speechMs?: number },
  context: string[],
  gate: Gate = {},
): GateDecision {
  const text = cleanCaption(candidate.text);
  const base: Omit<GateDecision, "verdict" | "question" | "usedContext" | "reason"> = {
    candidateId: candidate.id,
    candidate: text,
    context,
    ...(candidate.speechMs === undefined ? {} : { speechMs: Math.round(candidate.speechMs) }),
  };
  const silent = (verdict: GateVerdict, reason: string): GateDecision => ({
    ...base,
    verdict,
    question: null,
    usedContext: false,
    reason,
  });

  if (!text) return silent("empty", "Nothing was left after cleaning the caption.");
  // Checked before anything else: chatter is often a grammatical question, and
  // an open thread must not turn "can you hear me?" into a retrieval.
  if (isChatter(text)) return silent("chatter", CHATTER_REASON);
  // Social framing comes off clause by clause instead of silencing the line, so
  // a question survives the politeness in front of it. `base.candidate` keeps
  // the raw utterance: the diagnostic record shows what was said, not what was
  // gated on.
  const spoken = stripFiller(text);
  if (!spoken) return silent("chatter", CHATTER_REASON);

  // A line earns a search by being long enough to have been a whole question,
  // or by carrying a question mark. Speech that was not measured counts as
  // none: a path that does not report a duration has to bring the "?".
  if (!spoken.includes("?") && !((candidate.speechMs ?? 0) >= MIN_SPEECH_MS)) {
    return silent(
      "too-short",
      candidate.speechMs === undefined
        ? `No question mark, and the length of the speech was not measured (${MIN_SPEECH_MS} ms needed).`
        : `No question mark, and only ${Math.round(candidate.speechMs)} ms of speech (${MIN_SPEECH_MS} ms needed).`,
    );
  }
  if (trailsOff(spoken)) return silent("incomplete", "The line stops before the question is finished.");

  // The most recent utterance that was itself a question is the only thing
  // allowed to lend meaning to a terse or referential follow-up.
  const prior = [...context].reverse().find((line) => isLiveQuestion(line, gate));

  // Structured state from the last answered question. `prior` is only used to
  // decide that the room was mid-thread; its text never travels into the query.
  const thread = gate.threadOpen ? (gate.thread ?? null) : null;

  const unresolved = (resolution: Resolution): GateDecision => ({
    ...silent("unresolved-reference", `"${resolution.reference ?? spoken}" points at something the last answer did not establish: ${resolution.reason}.`),
    resolution,
  });
  const follow = (resolution: Resolution): GateDecision => {
    if (!resolution.question) return unresolved(resolution);
    return {
      ...base,
      verdict: "follow-up",
      question: resolution.question.slice(0, 280),
      usedContext: true,
      reason: null,
      resolution,
    };
  };

  if (TERSE.test(spoken)) {
    if (!gate.threadOpen || !prior || !thread) {
      return silent("orphan-follow-up", "A bare follow-up with no answered question for it to follow.");
    }
    return follow(resolveReference(normalizeSpokenQuestion(spoken).canonical, thread));
  }

  const rejected = whyNotLive(spoken, gate);
  if (rejected) return silent("not-a-question", rejected);

  const asked = extractQuestion(spoken);
  const canonical = normalizeSpokenQuestion(asked).canonical;
  const reference = referenceIn(canonical);
  // A question earns its own trigger; context only resolves what it points at.
  // "what does this contract say about termination?" names its own subject and
  // must never be dragged toward the previous topic, so grounding is reserved
  // for utterances that have nothing left once the pointer is removed.
  if (reference && needsGrounding(canonical, reference)) {
    if (!thread) return unresolved(resolveReference(canonical, null));
    return follow(resolveReference(canonical, thread));
  }
  return { ...base, verdict: "question", question: asked, usedContext: false, reason: null };
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
