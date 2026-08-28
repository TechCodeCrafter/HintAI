/**
 * Conversational reference resolution.
 *
 * Two measured failures share one cause. "And after that?" was answered by
 * pasting the previous question onto the current one, so the composer answered
 * the previous question again — the room asked what comes next and heard the
 * last step repeated. "So this service is doing all of it?" had no antecedent at
 * all, so "service" went to retrieval as a subject and an unrelated
 * `bedrock_service.py` won on the word alone.
 *
 * The rule both violate:
 *
 *   Context resolves references. Context does not become the question.
 *
 * So prior conversation is kept as structure, never as a text blob: what the
 * thread is about, which entities it established, what was already said. A
 * reference in the newest utterance is looked up against that structure and
 * replaced. What comes out is still the newest question, and it goes through the
 * ordinary pipeline afterwards with no relaxation — a resolved "Why?" is a WHY
 * question and still needs rationale evidence.
 *
 * Everything here is bounded to one open thread. It is not conversation memory.
 */

import type { Card } from "../repo/types.ts";
import type { Shape } from "./intent.ts";
import { contentWords } from "./spoken.ts";

/**
 * The minimum state worth keeping from the most recently answered question.
 * Seeded only by a Card that actually spoke, so an unanswered question never
 * becomes the thing pronouns point at.
 */
export type ThreadContext = {
  utteranceId: string;
  canonical: string;
  shape: Shape;
  /** Subject terms the answered question resolved to. */
  subject: string[];
  /** What was said out loud, used to refuse a replay of it. */
  claim: string;
  /** Cited evidence paths. */
  files: string[];
  /** Entity names the thread established — cited modules, and named subjects. */
  entities: string[];
  at: number;
};

export type ReferenceKind = "continuation" | "entity" | "pronoun" | "terse";

export type Reference = {
  kind: ReferenceKind;
  /** The words in the utterance that point at something already said. */
  phrase: string;
  /** For an entity reference, the kind of thing being pointed at. */
  noun?: string;
  direction?: "after" | "before";
};

export type Resolution = {
  reference: string | null;
  resolved: string | null;
  /** The question to run, or null when the reference cannot be grounded. */
  question: string | null;
  kind: ReferenceKind | "none";
  reason: string;
};

/** "and after that?", "then what?", "what's next?" — a request for the next step. */
const CONTINUATION =
  /\b(?:(?:and\s+)?(?:right\s+)?(after|before)\s+(?:that|this|it)|then\s+what|what\s+(?:happens|comes)\s+(?:next|after\s+(?:that|this|it))|what(?:'s|\s+is)\s+next|and\s+then)\b/i;

/**
 * Nouns that name a kind of thing rather than a thing. Behind "this" or "the"
 * they are references, and on their own they are not subjects.
 */
const KIND_NOUN =
  /\b(?:this|that|the|these|those)\s+(service|worker|job|handler|module|file|function|method|class|endpoint|route|lambda|script|pipeline|flow|process|thing|repo|api|component|step|call|way)\b/i;

/** Nouns naming the topic as a whole, which the thread's subject can answer. */
const TOPIC_NOUN = /^(thing|flow|process|step|call|pipeline|way)$/i;

/** A bare pointer, meaningful only against an open thread. */
const PRONOUN = /\b(it|that|this|there|those|these|the\s+same\s+thing)\b/i;

/** A bare interrogative: the whole question is a pointer at the last answer. */
const TERSE_HEAD = /^(why(?:\s+not)?|how(?:\s+(?:so|come))?|what|what\s+else|so\s+what|then\s+what)\b/i;

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z0-9_]+/g) ?? [];
}

/**
 * Verbs common in spoken questions, plus the inflections that give a verb away.
 * Used to tell "where is that stored?", which is nothing without the thread,
 * from "the in-memory repo — what's that for?", which names its own subject.
 * Biased towards calling a word a noun: mistaking a noun for a verb would ground
 * a question that never needed it and drag it onto the previous topic.
 */
const SPOKEN_VERB =
  /^(?:calls?|stores?|works?|runs?|uses?|handles?|happens?|fails?|triggers?|writes?|reads?|sends?|returns?|starts?|stops?|saves?|sets?|goes?|gets?|makes?|does|means?|lives?|talks?)$|(?:ed|ing)$/i;

/**
 * Words in the utterance that could name what it is about. A kind noun is not
 * one: "service" and "flow" are what the room points with, not what it points
 * at. Nor is a verb — "stored" says what happens to the subject, not what it is.
 */
export function subjectCandidates(text: string): string[] {
  return contentWords(text).filter((word) => !KIND_NOUN.test(`the ${word}`) && !SPOKEN_VERB.test(word));
}

/**
 * Does the utterance name its own subject? A question that does is never
 * resolved against the thread, however many pronouns it also contains: "what
 * does this contract say about termination?" is about termination.
 */
export function standsAlone(canonical: string): boolean {
  return subjectCandidates(canonical).length > 0;
}

/** The reference in the newest utterance, if it has one. */
export function referenceIn(canonical: string): Reference | null {
  const continuation = CONTINUATION.exec(canonical);
  if (continuation) {
    return {
      kind: "continuation",
      phrase: continuation[0].trim(),
      direction: continuation[1]?.toLowerCase() === "before" ? "before" : "after",
    };
  }

  const kind = KIND_NOUN.exec(canonical);
  if (kind) return { kind: "entity", phrase: kind[0].trim(), noun: kind[1].toLowerCase() };

  if (TERSE_HEAD.test(canonical) && contentWords(canonical).length === 0) {
    return { kind: "terse", phrase: canonical.replace(/[?.!,\s]+$/, "") };
  }

  const pronoun = PRONOUN.exec(canonical);
  if (pronoun) return { kind: "pronoun", phrase: pronoun[0].trim() };
  return null;
}

/**
 * Entities in the thread that could be the thing named by `noun`. More than one
 * is ambiguity, and ambiguity is silence: guessing between two services is how a
 * confident wrong answer is produced.
 */
function referents(thread: ThreadContext, noun: string): string[] {
  return [...new Set(thread.entities.filter((entity) => entity.includes(noun)))];
}

const silent = (reference: string | null, kind: Resolution["kind"], reason: string): Resolution => ({
  reference,
  resolved: null,
  question: null,
  kind,
  reason,
});

/**
 * Resolves the newest utterance against the open thread.
 *
 * Returns the question to run. A null question means the reference could not be
 * grounded, which is silence — never a fallback to the previous question.
 */
export function resolveReference(canonical: string, thread: ThreadContext | null): Resolution {
  const reference = referenceIn(canonical);
  if (!reference) {
    return { reference: null, resolved: null, question: canonical, kind: "none", reason: "no reference" };
  }
  if (!thread) {
    return silent(reference.phrase, reference.kind, "no active thread to resolve it against");
  }

  if (reference.kind === "continuation") {
    if (thread.subject.length === 0) {
      return silent(reference.phrase, reference.kind, "the thread has no subject to continue from");
    }
    // Deliberately not the previous question: a continuation asks for the step
    // on the other side of it, so only the subject carries over.
    const subject = thread.subject.join(" ");
    const question =
      reference.direction === "before"
        ? `what happens before ${subject}`
        : `what happens after ${subject}`;
    return {
      reference: reference.phrase,
      resolved: subject,
      question,
      kind: reference.kind,
      reason: `continuation ${reference.direction} the thread subject`,
    };
  }

  if (reference.kind === "entity") {
    const noun = reference.noun ?? "";
    const matches = referents(thread, noun);
    if (matches.length > 1) {
      return silent(reference.phrase, reference.kind, `ambiguous referent: ${matches.join(", ")}`);
    }
    if (matches.length === 0) {
      // A topic word points at the thread as a whole; a concrete kind of thing
      // has to have been established.
      if (TOPIC_NOUN.test(noun) && thread.subject.length > 0) {
        return {
          reference: reference.phrase,
          resolved: thread.subject.join(" "),
          question: canonical.replace(reference.phrase, thread.subject.join(" ")),
          kind: reference.kind,
          reason: "topic reference resolved to the thread subject",
        };
      }
      return silent(reference.phrase, reference.kind, `the thread established no ${noun}`);
    }
    return {
      reference: reference.phrase,
      resolved: matches[0],
      question: canonical.replace(reference.phrase, matches[0]),
      kind: reference.kind,
      reason: `single referent in the thread`,
    };
  }

  // A bare pointer, or a whole question that is one. Both take what the thread
  // is about — the entity it cited and the subject it resolved to, as terms,
  // never its question text. Both, because either alone loses something: the
  // module name misses the topic, the topic misses which module.
  const referent = [...new Set([...(thread.entities.length === 1 ? thread.entities : []), ...thread.subject])]
    .join(" ")
    .trim();
  if (!referent) {
    return silent(reference.phrase, reference.kind, "the thread has no resolved subject");
  }
  const question =
    reference.kind === "terse"
      ? `${reference.phrase} ${referent}`
      : canonical.replace(reference.phrase, referent);
  return {
    reference: reference.phrase,
    resolved: referent,
    question,
    kind: reference.kind,
    reason: reference.kind === "terse" ? "bare interrogative against the thread subject" : "pointer to the thread subject",
  };
}

/** Identifier-ish names a path establishes: the module, and its own words. */
function entitiesFromPath(path: string): string[] {
  const base = path.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? "";
  if (!base) return [];
  return [base.toLowerCase()];
}

/**
 * Builds the thread from a Card that spoke. Only a spoken, cited Card seeds a
 * thread — an unanswered question leaves nothing for a pronoun to point at.
 */
export function threadFrom(input: {
  utteranceId: string;
  canonical: string;
  shape: Shape;
  subject: string[];
  card: Card;
  at?: number;
}): ThreadContext | null {
  if (!input.card.say) return null;
  // Entities come from cited material only. Deriving them from the question's
  // own words would let an ordinary word like "service" register as a second
  // candidate and make every reference look ambiguous.
  const files = [...new Set(input.card.citations.map((c) => c.path))];
  return {
    utteranceId: input.utteranceId,
    canonical: input.canonical,
    shape: input.shape,
    subject: input.subject,
    claim: input.card.say,
    files,
    entities: [...new Set(files.flatMap(entitiesFromPath))],
    at: input.at ?? Date.now(),
  };
}

/** Has the thread gone quiet long enough that a pointer cannot reach it? */
export function threadAlive(thread: ThreadContext | null, windowMs: number, now = Date.now()): boolean {
  return Boolean(thread) && now - (thread as ThreadContext).at < windowMs;
}

function sameLine(a: string, b: string): boolean {
  const flat = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return flat(a) === flat(b);
}

/**
 * A follow-up may not be answered with the line the thread already said. This is
 * the last defence against replay: even if resolution and retrieval both drift
 * back to the previous evidence, the room does not hear the same sentence twice
 * as the answer to a different question.
 */
export function withdrawReplay(card: Card, thread: ThreadContext | null, resolved: boolean): Card {
  if (!resolved || !card.say || !thread) return card;
  if (!sameLine(card.say, thread.claim)) return card;
  return {
    ...card,
    say: null,
    reason: "That is the same answer I just gave — nothing loaded takes it further.",
  };
}
