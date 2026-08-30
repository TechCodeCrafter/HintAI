/**
 * What kind of answer a question demands, and whether a piece of evidence is
 * that kind of answer.
 *
 * Support validation asks "is every word of this claim in the cited file?" and
 * that is necessary but not sufficient: a docstring quoted perfectly can still
 * answer a question nobody asked. "Why did we choose this?" is not answered by
 * a description of what the thing does, however well cited. This module holds
 * the second test — does the evidence answer *this* question — so the composer
 * can stay silent on a shape it cannot support instead of speaking confidently
 * about something adjacent.
 */

export type Shape =
  /** Behaviour or purpose: what a thing is or does. */
  | "what"
  /** Mechanism: how something is carried out. */
  | "how"
  /** Location: which file or component. */
  | "where"
  /** Rationale: why a choice was made. Needs evidence that states a reason. */
  | "why"
  /** Error paths: what happens when something breaks. */
  | "failure"
  /** Existence: whether the repo has a thing at all. */
  | "absence"
  /** Authorship. */
  | "who";

/** A denial somewhere in the utterance. */
const NEGATED = /\b(not|never|none|nothing|nowhere)\b|\bno\b|n['’]t\b/;

/** Asking the room to agree, which makes the sentence a question. */
const CONFIRMATION = /\b(right|correct|true|yeah|yes|no)\s*\?*\s*$|\b(is|are|isn['’]?t|aren['’]?t|do|don['’]?t|does|doesn['’]?t|have|haven['’]?t)\s+(it|we|they|you|there)\s*\?*\s*$/;

/** "at all", "any", "anywhere" — the vocabulary of asserting a gap. */
const EMPHATIC_ABSENCE = /\bat all\b|\bany(thing|where|more)?\b/;

/**
 * Order is the whole design. "What happens if the upload fails?" opens with
 * "what" but demands error-path evidence, and "Do we have tests?" is a yes/no
 * about existence rather than a request for a description.
 */
export function shapeOf(query: string): Shape {
  const q = query.toLowerCase().trim();
  if (/\b(who|whom|whose)\b/.test(q) || /\bwho (wrote|touched|owns|added|changed)\b/.test(q)) return "who";
  // A challenge is an absence question wearing a statement's clothes. "We're not
  // testing this at all, right?" asks GROUND to confirm that something does not
  // exist, and nothing retrieved can confirm that — least of all a file that
  // happens to describe adjacent work.
  if (NEGATED.test(q) && (CONFIRMATION.test(q) || EMPHATIC_ABSENCE.test(q))) return "absence";
  if (
    /\b(do|does|did|have|has) (we|you|they|i|it) (have|has|had|use|uses|support|supports|include|includes|contain|contains)\b/.test(
      q,
    ) ||
    /\b(is|are) there (a|an|any|some)\b/.test(q) ||
    /\bdo we (have|use)\b/.test(q)
  ) {
    return "absence";
  }
  if (
    /\bwhat happens (if|when)\b/.test(q) ||
    /\b(if|when) .*\b(fail|fails|failed|breaks|broken|errors?|times out|crashes)\b/.test(q) ||
    /\b(error|exception|failure|retry|retries|timeout|fallback|rollback) (handling|behaviour|behavior|path|logic)\b/.test(
      q,
    )
  ) {
    return "failure";
  }
  if (/^why\b/.test(q) || /\bwhy (is|are|was|were|did|does|do|would|should|the|we|they)\b/.test(q)) return "why";
  if (/^where\b/.test(q) || /\bwhere (is|are|does|do|did|in the)\b/.test(q)) return "where";
  if (/^how\b/.test(q) || /\bhow (is|are|does|do|did|would|can)\b/.test(q)) return "how";
  return "what";
}

/**
 * Evidence that states a reason rather than a behaviour. A file that says "we
 * cap retries at three because the payment gateway stalls" carries rationale;
 * one that says "retries three times" does not, however relevant it is.
 */
const RATIONALE =
  /\b(because|since|so that|in order to|to avoid|to prevent|to ensure|rather than|instead of|trade[- ]?off|on purpose|by design|deliberately|intentionally|the reason|rationale|decided|decision|chose|chosen|opted|due to|owing to|required by|constraint|limitation|workaround|prevents|avoids)\b/i;

/** Prose that states who is responsible, rather than describing behaviour. */
const OWNERSHIP =
  /\b(owned|owner|owners|ownership|maintained|maintainer|maintainers|authored|responsible for|on-call|oncall|codeowner|codeowners)\b/i;

/**
 * Evidence about what happens when things break, as opposed to what happens
 * when they work.
 */
const FAILURE_EVIDENCE =
  /\b(fail|fails|failed|failure|failures|error|errors|exception|exceptions|raise|raises|raised|retry|retries|retried|timeout|timed out|fallback|falls back|rollback|rolls back|dead[- ]letter|catch|caught|except|recover|recovery|abort|aborts|invalid|reject|rejects|rejected)\b/i;

/**
 * Does this evidence answer a question of this shape?
 *
 * `whyKind` is true for a commit message or ADR, which is rationale evidence by
 * construction: it exists to record why a change was made.
 */
export function evidenceFitsShape(
  shape: Shape,
  claim: string,
  whyKind = false,
  authored = false,
): boolean {
  switch (shape) {
    case "why":
      // A description of behaviour is never a reason for it.
      return whyKind || RATIONALE.test(claim);
    case "failure":
      return FAILURE_EVIDENCE.test(claim);
    case "who":
      // Authorship is a property of history, not of prose. A docstring saying
      // what a file does answers "how", and letting it through here is how "who
      // touched the auth flow?" gets answered with "verifies the session cookie
      // on every non-public request" — cited, true, and not the question.
      //
      // `authored` means the evidence identifies a person and the claim names
      // them. Being a commit is not enough on its own: a commit message states
      // what changed, and only its author field states who. Prose qualifies when
      // it states ownership outright, which is what a CODEOWNERS note or an
      // "owned by" line in a README does.
      return authored || OWNERSHIP.test(claim);
    case "absence":
      // Nothing retrieved can prove a repo does *not* contain something, and a
      // docstring that merely mentions the word is not proof that it does. This
      // shape stays silent until the answer can be drawn from the file tree.
      return false;
    default:
      return true;
  }
}

/** What to tell the room when the evidence is the wrong kind for the question. */
export function shapeGap(shape: Shape): string {
  switch (shape) {
    case "why":
      return "The material says what this does, not why it was chosen.";
    case "failure":
      return "Nothing loaded shows what happens when that fails.";
    case "absence":
      return "Nothing loaded proves that either way.";
    case "who":
      return "The material says what this does, not who owns it.";
    default:
      return "Nothing loaded answers that.";
  }
}
