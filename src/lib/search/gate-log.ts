/**
 * A bounded record of why each incoming utterance did or did not produce a Card.
 *
 * Deliberately outside the store: this is diagnostic state, and putting it in the
 * store would re-render the UI on every frame of speech. It keeps only the
 * decision — utterance identity, verdict, dedupe outcome — never audio, and it
 * is capped so a long meeting cannot grow it without bound.
 */
import { isSearchDebug } from "../debug.ts";
import type { GateDecision } from "./question.ts";

export type GateRecord = GateDecision & {
  at: number;
  /** The utterance whose question was last acted on, before this decision. */
  lastHandledId: string | null;
  /** Why the question was or was not passed to retrieval after the gate allowed it. */
  dedupe: "fresh" | "same-utterance-and-question" | "suppressed-by-typing" | "auto-answer-off";
  triggered: boolean;
};

const MAX = 60;
let records: GateRecord[] = [];

declare global {
  interface Window {
    __groundGate?: {
      records: () => GateRecord[];
      /** Only the utterances that were turned away, each with its reason. */
      rejected: () => GateRecord[];
      reset: () => void;
    };
  }
}

export function recordGate(record: GateRecord) {
  records.push(record);
  if (records.length > MAX) records = records.slice(-MAX);
  if (record.reason && isSearchDebug()) console.info(rejectionLine(record));
  if (typeof window !== "undefined" && !window.__groundGate) {
    window.__groundGate = {
      records: () => records,
      rejected: rejectedGateRecords,
      reset: resetGateRecords,
    };
  }
}

export function gateRecords(): GateRecord[] {
  return records;
}

/**
 * The utterances the gate turned away, oldest first, each with the reason. A
 * line that passed the gate and was then not searched (auto answer off, typing
 * in the box, already handled) is not a rejection and is not listed.
 */
export function rejectedGateRecords(): GateRecord[] {
  return records.filter((record) => record.reason !== null);
}

/** One rejection as a console line. Printed only when search debugging is on. */
export function rejectionLine(record: GateRecord): string {
  const speech = record.speechMs === undefined ? "" : ` after ${record.speechMs} ms of speech`;
  return `[gate] rejected (${record.verdict})${speech}: ${JSON.stringify(record.candidate)}. ${record.reason}`;
}

/** Test seam: empties the log. */
export function resetGateRecords() {
  records = [];
}
