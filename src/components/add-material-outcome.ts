/**
 * What the person sees after adding material to an existing Knowledge Space
 * (space detail page and the live cockpit).
 *
 * The store reports a failed add only through `folderError` (and, for a failed
 * save, `contextError`); `contextStatus` stays "ready" when the space already
 * had material. So the outcome is judged from what actually changed in the
 * space's sources, plus whichever error text the store left behind. That keeps
 * success wording off a failed upload and keeps a failure from implying the
 * existing material is gone.
 */

import { isPdfSource, type StoredSource } from "../lib/context/types.ts";
import { pdfSourceStatus } from "../lib/document/pdf/source-status.ts";

export type SourceMark = {
  /** Stable row id. */
  key: string;
  updatedAt: number;
  /** Display name, used when naming a row that could not be read. */
  name: string;
  /** Short reason when the row exists but cannot be used (e.g. "Cannot read"). */
  problem?: string | null;
};

export type AddStep = {
  kind: "files" | "pdfs";
  before: SourceMark[];
  after: SourceMark[];
  /** `folderError` read right after this step finished. */
  folderError: string | null;
  /** `contextError` read right after this step finished. */
  contextError?: string | null;
  /** The call rejected instead of resolving. */
  threw?: boolean;
  /**
   * What to do about rows that were stored but cannot be used. Defaults to
   * pointing at the source list; screens without one pass their own next step.
   */
  unusableHint?: string;
};

export type AddOutcome = {
  tone: "ok" | "warn" | "error";
  text: string;
  /** The problem alone, without "Nothing was added" framing, for combining steps. */
  reason?: string;
};

function changedRows(before: SourceMark[], after: SourceMark[]): SourceMark[] {
  const seen = new Map(before.map((row) => [row.key, row.updatedAt]));
  return after.filter((row) => seen.get(row.key) !== row.updatedAt);
}

function sameText(a: string, b: string) {
  return a.trim().replace(/\.$/, "") === b.trim().replace(/\.$/, "");
}

const SPACE_KEPT = "Your existing material is unchanged.";
const NOTHING_ADDED = /nothing was added/i;
const ALREADY_KEPT = /existing material is unchanged/i;

export function describeAddStep(step: AddStep): AddOutcome {
  const changed = changedRows(step.before, step.after);
  const hadMaterial = step.before.length > 0;
  const error = step.folderError?.trim() || step.contextError?.trim() || null;
  const kept =
    hadMaterial && step.after.length >= step.before.length && !(error && ALREADY_KEPT.test(error))
      ? ` ${SPACE_KEPT}`
      : "";
  const what = step.kind === "pdfs" ? "those PDFs" : "those files";

  if (changed.length === 0) {
    if (step.threw) {
      const reason = `Could not add ${what}. Try again, or pick different files.`;
      return { tone: "error", text: `${reason}${kept}`, reason };
    }
    if (error) {
      const framed = NOTHING_ADDED.test(error) ? error : `Nothing was added. ${error}`;
      return { tone: "error", text: `${framed}${kept}`, reason: error.replace(/\s*Nothing was added\.?/i, "").trim() };
    }
    const reason = `${step.kind === "pdfs" ? "Those PDFs" : "Those files"} may already be in this space.`;
    return { tone: "error", text: `Nothing new was added. ${reason}`, reason };
  }

  const broken = changed.filter((row) => row.problem);
  const notes: string[] = [];
  if (broken.length > 0) {
    const named = broken
      .slice(0, 3)
      .map((row) => `${row.name} (${row.problem})`)
      .join(", ");
    const more = broken.length > 3 ? ` and ${broken.length - 3} more` : "";
    notes.push(`Could not use ${named}${more}. ${step.unusableHint ?? "Open the source list for details."}`);
  }
  if (error && !notes.some((note) => sameText(note, error))) notes.push(error);
  if (step.threw && notes.length === 0) notes.push("Part of that upload did not finish. Check the source list.");

  if (broken.length === changed.length) {
    return { tone: "error", text: notes.join(" "), reason: notes.join(" ") };
  }
  if (notes.length > 0) {
    return { tone: "warn", text: `Some material was added. ${notes.join(" ")}`, reason: notes.join(" ") };
  }
  return { tone: "ok", text: "Material added." };
}

/** One message for a drop that ran the files step and then the PDF step. */
export function combineAddOutcomes(outcomes: AddOutcome[]): AddOutcome | null {
  if (outcomes.length === 0) return null;
  if (outcomes.length === 1) return outcomes[0]!;
  const rank = { ok: 0, warn: 1, error: 2 } as const;
  const errors = outcomes.filter((o) => o.tone === "error");
  const anyAdded = outcomes.some((o) => o.tone !== "error");
  if (errors.length === 0 && outcomes.every((o) => o.tone === "ok")) return { tone: "ok", text: "Material added." };
  if (!anyAdded) {
    const reasons = dedupe(outcomes.map((o) => o.reason ?? o.text));
    const kept = outcomes.some((o) => ALREADY_KEPT.test(o.text)) && !reasons.some((r) => ALREADY_KEPT.test(r)) ? ` ${SPACE_KEPT}` : "";
    return { tone: "error", text: `Nothing was added. ${reasons.join(" ")}${kept}`, reason: reasons.join(" ") };
  }
  const worst = outcomes.reduce((a, b) => (rank[b.tone] > rank[a.tone] ? b : a));
  const problems = outcomes.filter((o) => o.tone !== "ok").map((o) => o.reason ?? o.text);
  return {
    tone: worst.tone === "error" ? "warn" : worst.tone,
    text: `Some material was added. ${dedupe(problems).join(" ")}`,
    reason: dedupe(problems).join(" "),
  };
}

function dedupe(texts: string[]): string[] {
  const out: string[] = [];
  for (const text of texts) if (!out.includes(text)) out.push(text);
  return out;
}

const IN_PROGRESS = new Set(["Waiting", "Reading…", "Indexing…"]);

/** One mark per stored source row, flagging PDFs that were stored but cannot be used. */
export function marksFromSources(sources: StoredSource[]): SourceMark[] {
  return sources.map((source) => {
    if (!isPdfSource(source)) {
      return { key: source.id, updatedAt: source.updatedAt, name: source.path };
    }
    const status = pdfSourceStatus(source);
    const problem =
      IN_PROGRESS.has(status.short)
        ? null
        : status.short !== "Ready"
          ? status.short
          : source.lastFailedNote
            ? "update failed, previous version kept"
            : null;
    // displayName drops the extension ("broken"); the path keeps the file name
    // the person picked ("broken.pdf").
    const name = source.path.split("/").filter(Boolean).pop() || source.displayName;
    return { key: source.id, updatedAt: source.updatedAt, name, problem };
  });
}

export type IndexingView = "working" | "ready" | "failed";

/**
 * The create flow's indexing step. "Ready" needs a judged outcome that added
 * something usable to the space this flow created; a stored source count or
 * `contextStatus === "ready"` is not enough, because an unreadable PDF is
 * stored as a source with nothing to search.
 */
export function indexingView(args: {
  adding: boolean;
  outcome: AddOutcome | null;
  /** The store's active space is still the one this flow is filling. */
  onTarget: boolean;
}): IndexingView {
  if (args.adding) return "working";
  if (!args.outcome || args.outcome.tone === "error" || !args.onTarget) return "failed";
  return "ready";
}
