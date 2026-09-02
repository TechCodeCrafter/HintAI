import type { Utterance } from "../repo/types.ts";
import type { Evidence } from "../search/evidence.ts";

/** Product ledger: green supported or yellow unverified. Red is icebox. */
export type ClaimStatus = "supported" | "unverified";

export type Claim = {
  id: string;
  meetingId: string;
  speaker: string;
  text: string;
  timestamp: number;
  status: ClaimStatus;
  evidence: Evidence[] | null;
  relatedClaimIds: string[];
};

export type MeetingRecord = {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  utterances: Utterance[];
  claims: Claim[];
};

export function newMeetingRecord(name: string, startedAt = Date.now()): MeetingRecord {
  return {
    id: crypto.randomUUID(),
    name,
    startedAt,
    endedAt: null,
    utterances: [],
    claims: [],
  };
}

export function newClaim(input: {
  meetingId: string;
  speaker: string;
  text: string;
  timestamp?: number;
}): Claim {
  return {
    id: crypto.randomUUID(),
    meetingId: input.meetingId,
    speaker: input.speaker,
    text: input.text,
    timestamp: input.timestamp ?? Date.now(),
    status: "unverified",
    evidence: null,
    relatedClaimIds: [],
  };
}
