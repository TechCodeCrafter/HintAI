import type { RepoPack } from "../repo/types.ts";
import { getMeetingRepository } from "./repository.ts";
import { claimAuditReport } from "./report.ts";
import { newMeetingRecord, type MeetingRecord } from "./types.ts";

export function meetingTitle(pack: RepoPack, startedAt: number): string {
  return `${pack.name} · ${new Date(startedAt).toISOString().slice(0, 16).replace("T", " ")}`;
}

export async function persistMeeting(meeting: MeetingRecord): Promise<void> {
  await getMeetingRepository().put(meeting);
}

export async function loadMeetings(): Promise<MeetingRecord[]> {
  return getMeetingRepository().list();
}

export async function finishMeeting(meeting: MeetingRecord, utterances: MeetingRecord["utterances"]): Promise<{
  meeting: MeetingRecord;
  report: string;
  history: MeetingRecord[];
}> {
  const ended = { ...meeting, endedAt: meeting.endedAt ?? Date.now(), utterances };
  const history = await getMeetingRepository().listPast(ended.id);
  const report = claimAuditReport(ended, history);
  await getMeetingRepository().put(ended);
  return { meeting: ended, report, history: await getMeetingRepository().list() };
}

export function latestOpenMeeting(rows: MeetingRecord[]): MeetingRecord | null {
  return rows.find((row) => row.endedAt == null) ?? rows[0] ?? null;
}

export { newMeetingRecord };
