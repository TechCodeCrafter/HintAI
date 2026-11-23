/**
 * Why the product stayed silent, in words the room can read.
 *
 * Silence is the product working, so it must never look like the product
 * failing: every silent Card carries one sentence naming the actual cause and a
 * kind the UI can act on. Nothing here produces an answer. A reason describes
 * what was checked and why nothing was said; it never fills the gap with
 * general knowledge.
 */

export type SilenceKind =
  /** Retrieval found nothing, or the question is about things the files never name. */
  | "no-match"
  /** Retrieval found something, but too little of it overlaps the question to cite. */
  | "weak-match"
  /** Related material was read, and it does not state the answer. */
  | "not-stated"
  /** A candidate answer existed and failed the evidence check. */
  | "unverified"
  /** The question points at a document that could not be singled out. */
  | "ambiguous"
  /** The index is empty, stale, unreadable, or failed while searching. */
  | "index"
  /** The model could not be reached or did not return a usable response. */
  | "transport";

export type Silence = { kind: SilenceKind; reason: string };

function because(kind: SilenceKind, reason: string): Silence {
  return { kind, reason };
}

export const SILENCE = {
  noMatch: because("no-match", "Nothing in your files covers this."),
  offTopic: because(
    "no-match",
    "Nothing in your files covers this. The question looks unrelated to what is loaded.",
  ),
  unknownDocument: because("no-match", "No loaded document matches that name."),
  weakMatch: because(
    "weak-match",
    "Only weak matches found. Nothing in your files covers this closely enough to cite.",
  ),
  testsOnly: because("not-stated", "Only the tests describe that. Nothing loaded says what it does."),
  noSentence: because("not-stated", "Found a related file, but nothing in it states this in words I can cite."),
  notStated: because("not-stated", "Found related material, but nothing in it states an answer I can cite."),
  offSubject: because(
    "not-stated",
    "The closest material is about something else, so there is nothing to cite for this.",
  ),
  noSpan: because(
    "unverified",
    "I had a possible answer but could not tie it to an exact line in your files, so I stayed silent.",
  ),
  unsupported: because("unverified", "I could not back every word of that from the file."),
  whichDocument: because("ambiguous", "I cannot tell which document you mean. Name it and ask again."),
  ambiguousDocument: because(
    "ambiguous",
    "More than one loaded document matches that name. Name the one you mean and ask again.",
  ),
  stale: because("index", "That material changed since it was indexed, so I will not quote the old version."),
  gone: because("index", "That material is no longer loaded, so there is nothing to cite."),
  outdatedIndex: because("index", "That document's index is out of date, so I will not quote from it."),
  noSearchableText: because("index", "That document has no searchable text, so there is nothing in it to cite."),
  nothingIndexed: because("index", "Nothing is indexed in this space yet, so there was nothing to search."),
} as const satisfies Record<string, Silence>;

/** The two fields a silent Card carries. Spread into the Card beside `say: null`. */
export function silent(why: Silence): { reason: string; silence: SilenceKind } {
  return { reason: why.reason, silence: why.kind };
}

/** A shape gap ("says what this does, not why") is always "read it, not stated". */
export function notStated(reason: string): Silence {
  return because("not-stated", reason.trim() || SILENCE.notStated.reason);
}

const NAMED_TERMS = 3;

/**
 * The question is mostly about words the searched files never contain. Naming
 * them tells the room exactly what was looked for.
 */
export function unknownTerms(terms: readonly string[]): Silence {
  const named = [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, NAMED_TERMS);
  if (named.length === 0) return SILENCE.noMatch;
  const list = named.map((term) => `"${term}"`).join(", ");
  return because("no-match", `Nothing in your files covers this. I could not find ${list} in the files I searched.`);
}

const DETAIL_CAP = 80;

function detail(message: string): string {
  return message.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "").slice(0, DETAIL_CAP);
}

/**
 * A model failure as a sentence. The raw messages come from the provider
 * client ("Add API key", "timeout", "OpenAI 500"); none of them is shown as
 * is. "API key" stays in the wording wherever a key is the fix, because the
 * answer pane offers the key dialog on that phrase.
 */
export function transportSilence(rawMessage: string): Silence {
  const message = detail(rawMessage);
  const provider = /^(OpenAI|Anthropic|xAI)\b/.exec(message)?.[1] ?? "The model provider";
  const model = provider === "The model provider" ? "the model" : provider;

  if (/^add api key$/i.test(message) || /\bno api key\b/i.test(message)) {
    return because("transport", "No API key is set, so the model could not read your files. Add an API key and ask again.");
  }
  if (/rejected the api key|\b401\b|\b403\b/i.test(message)) {
    return because("transport", `${provider} rejected the API key. Check the key and ask again.`);
  }
  if (/rate limit|\b429\b/i.test(message)) {
    return because("transport", `${provider} rate limit reached. Wait a moment and ask again.`);
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return because("transport", "The model did not respond in time. Check your connection and ask again.");
  }
  if (/failed to fetch|network|load failed/i.test(message)) {
    return because("transport", "The model provider could not be reached. Check your connection and ask again.");
  }
  const status = /^(?:OpenAI|Anthropic|xAI) (\d{3})$/.exec(message)?.[1];
  if (status) {
    return because("transport", `${provider} returned an error (${status}). Ask again in a moment.`);
  }
  if (/^empty( stream)?$/i.test(message)) {
    return because("transport", `The response from ${model} was empty. Ask again.`);
  }
  if (/^empty prompt$/i.test(message)) {
    return because("transport", "The question was empty by the time it reached the model. Ask it again.");
  }
  return because(
    "transport",
    message ? `The model call failed (${message}). Ask again.` : "The model call failed. Ask again.",
  );
}

/**
 * Retrieval or routing threw. This is never the material's fault, so it is
 * never reported as "nothing covers this".
 */
export function searchFailureSilence(error: unknown): Silence {
  const scope =
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "workspace-scope";
  if (scope) {
    return because(
      "index",
      "Search was blocked because this space's index does not belong to the current workspace. Reopen the space and ask again.",
    );
  }
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = detail(raw);
  return because(
    "index",
    message
      ? `Search failed before your files could be checked (${message}). Reload the page and ask again.`
      : "Search failed before your files could be checked. Reload the page and ask again.",
  );
}

/**
 * Shown on a Card that speaks when the model could not be reached and the
 * offline composer answered from the files instead.
 */
export const MODEL_FALLBACK_NOTE = "Model unreachable. Using local extraction.";

/**
 * Why a Card was composed locally when the plan's daily model answers are
 * used up. The model was not asked, so nothing is said about it being down.
 */
export const QUOTA_FALLBACK_REASON =
  "Today's model answers are used up, so this was read from your files by local extraction.";
export const QUOTA_FALLBACK_NOTE = "Daily model limit reached. Using local extraction.";

/** The short note for a Card the offline composer answered in the model's place. */
export function modelFallbackNote(reason: string | undefined): string {
  return reason === QUOTA_FALLBACK_REASON ? QUOTA_FALLBACK_NOTE : MODEL_FALLBACK_NOTE;
}

/** What the screen knows about the search behind a silent Card, at the time it is shown. */
export type SilenceFacts = {
  /** Files retrieval ranked for the question that are still loaded and can be listed. */
  hits: number;
  /** Loaded files that were skipped, so search never read them. */
  skipped: number;
};

export type SilenceGuidance = {
  /** What happened and what to do next. Always ends in an action. */
  headline: string;
  /** The Card's own reason, when it says more than the headline does. */
  detail: string | null;
  /** What opening the reason lists. Never true for a list that would be empty. */
  shows: { hits: boolean; skipped: boolean };
};

/** `reason` with any of the generic sentences taken off the front, or null when nothing is left. */
function beyond(reason: string | undefined, ...generic: string[]): string | null {
  let rest = (reason ?? "").trim();
  for (const lead of generic) {
    if (rest.startsWith(lead)) rest = rest.slice(lead.length).trim();
  }
  return rest || null;
}

function filesSkipped(count: number): string {
  return count === 1 ? "1 file was skipped" : `${count.toLocaleString("en-US")} files were skipped`;
}

/**
 * The next step for a silent Card, by kind. Every kind ends in something the
 * person can do, and nothing here states a fact the caller did not pass in:
 * "check top hits" is only said when there are hits to open, and a skipped
 * count is only said when files were skipped.
 *
 * The Card's `reason` is kept as the detail, because a kind is coarser than a
 * cause ("no-match" is also "no loaded document has that name"). Returns null
 * for a Card with no kind, which the caller shows as it always did.
 */
export function silenceGuidance(
  card: { reason?: string | null; silence?: SilenceKind },
  facts: SilenceFacts,
): SilenceGuidance | null {
  if (!card.silence) return null;
  const reason = card.reason ?? undefined;
  const hits = facts.hits > 0;
  const skipped = facts.skipped > 0;
  const shows = { hits, skipped };

  switch (card.silence) {
    case "no-match":
      // Two no-match causes are not "the terms are absent": the question was
      // judged unrelated, or it named a document that is not loaded. Files may
      // still have been ranked for either, so neither claims the terms are missing.
      if (reason === SILENCE.offTopic.reason) {
        return { headline: "This looks unrelated to what is loaded. Add more material or rephrase.", detail: null, shows };
      }
      if (reason === SILENCE.unknownDocument.reason) {
        return { headline: "No loaded document matches that name. Add the document or rephrase.", detail: null, shows };
      }
      return {
        headline: "No files contain these terms. Add more material or rephrase.",
        detail: beyond(reason, SILENCE.noMatch.reason),
        shows,
      };
    case "weak-match":
      return {
        headline: hits
          ? "Found related files but low confidence. Check top hits."
          : "Found only weak matches, and none in a file that can be opened. Rephrase or add more material.",
        detail: beyond(reason, SILENCE.weakMatch.reason),
        shows,
      };
    case "not-stated":
      return {
        headline: hits
          ? "Read the closest files and none states this. Check top hits, or add the document that does."
          : "Read the closest material and none of it states this. Add the document that does.",
        detail: beyond(reason, SILENCE.notStated.reason),
        shows,
      };
    case "unverified":
      return {
        headline: hits
          ? "Had a possible answer but could not verify it. Check top hits before you say it."
          : "Had a possible answer but could not verify it. Ask about one specific file or term.",
        detail: beyond(reason),
        shows,
      };
    case "ambiguous": {
      // The two fixed reasons already are the step ("Name it and ask again").
      const own = reason === SILENCE.whichDocument.reason || reason === SILENCE.ambiguousDocument.reason;
      return {
        headline: own ? reason : "Cannot tell which document you mean. Name the document and ask again.",
        detail: own ? null : beyond(reason),
        shows,
      };
    }
    case "index":
      return {
        headline: skipped
          ? `${filesSkipped(facts.skipped)}. See list.`
          : "The index could not be used for this question. Add the material again, or reload.",
        detail: beyond(reason),
        shows,
      };
    case "transport":
      // A silent Card after a model failure means the offline composer ran on
      // the same hits and had nothing it could cite. The fix is in the detail.
      return {
        headline: "Model unreachable. Local extraction found nothing to cite.",
        detail: beyond(reason),
        shows,
      };
  }
}

export type FailFastCause = "no-hits" | "off-topic" | "weak";

export type SilenceInput = {
  /** Hits retrieval handed to the answer stages. */
  hitCount: number;
  /** Why the route stopped before any answer stage ran, if it did. */
  failFast?: FailFastCause | null;
  /** Chunks in the index that was searched, when the caller knows. */
  indexedChunks?: number;
  /** The first model error, raw. */
  modelError?: string;
  /** True when a model stage ran to completion and declined to answer. */
  modelDeclined?: boolean;
  /** What the offline composer said about its own silence. */
  local?: { reason?: string; silence?: SilenceKind } | null;
};

/**
 * One cause per silent Card, most actionable first:
 *
 * 1. Nothing was indexed, so there was nothing to search.
 * 2. Retrieval found nothing, or only weak matches, and no answer stage ran.
 * 3. The model never completed. The files were not fully checked, so the
 *    material is not blamed; the reason says what to fix.
 * 4. The composer's own reason. It read the hits and knows what was missing.
 * 5. The model read the hits and declined, with no composer to say more.
 */
export function explainSilence(input: SilenceInput): Silence {
  if (input.indexedChunks === 0 && input.hitCount === 0) return SILENCE.nothingIndexed;

  if (input.failFast === "no-hits" || input.hitCount === 0) return SILENCE.noMatch;
  if (input.failFast === "off-topic") return SILENCE.offTopic;
  if (input.failFast === "weak") return SILENCE.weakMatch;

  const modelError = input.modelError?.trim();
  if (modelError && !input.modelDeclined) return transportSilence(modelError);

  const local = input.local?.reason?.trim();
  if (local) return because(input.local?.silence ?? "not-stated", local);

  return SILENCE.notStated;
}
