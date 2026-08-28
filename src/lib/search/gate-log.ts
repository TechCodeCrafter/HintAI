/**
 * A bounded record of why each incoming utterance did or did not produce a Card.
 *
 * Deliberately outside the store: this is diagnostic state, and putting it in the
 * store would re-render the UI on every frame of speech. It keeps only the
 * decision — utterance identity, verdict, dedupe outcome — never audio, and it
 * is capped so a long meeting cannot grow it without bound.
 */
import type { GateDecision } from "./question";

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
      reset: () => void;
    };
  }
}

export function recordGate(record: GateRecord) {
  records.push(record);
  if (records.length > MAX) records = records.slice(-MAX);
  if (typeof window !== "undefined" && !window.__groundGate) {
    window.__groundGate = {
      records: () => records,
      reset: () => {
        records = [];
      },
    };
  }
}

export function gateRecords(): GateRecord[] {
  return records;
}
