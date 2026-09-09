import { contextDatabaseName, currentAccountId, onAccountUnbind } from "../auth/account-boundary.ts";
import { MeetHintDatabase } from "../context/storage/indexeddb.ts";
import { DATABASE_NAME } from "../context/storage/schema.ts";
import type { MeetingRecord } from "./types.ts";

function withAnswerHistory(record: MeetingRecord): MeetingRecord {
  return { ...record, answerHistory: record.answerHistory ?? [] };
}

export type MeetingRepository = {
  put(record: MeetingRecord): Promise<void>;
  get(id: string): Promise<MeetingRecord | null>;
  list(): Promise<MeetingRecord[]>;
  listPast(excludeId?: string): Promise<MeetingRecord[]>;
  delete(id: string): Promise<void>;
};

function newestFirst(rows: MeetingRecord[]): MeetingRecord[] {
  return [...rows].sort((a, b) => b.startedAt - a.startedAt || a.name.localeCompare(b.name));
}

export function createDexieMeetingRepository(dbName = DATABASE_NAME): MeetingRepository {
  const db = new MeetHintDatabase(dbName);
  return {
    async put(record) {
      await db.meetings.put(record);
    },
    async get(id) {
      const row = await db.meetings.get(id);
      return row ? withAnswerHistory(row) : null;
    },
    async list() {
      return newestFirst((await db.meetings.toArray()).map(withAnswerHistory));
    },
    async listPast(excludeId) {
      const rows = await db.meetings.toArray();
      return newestFirst(
        rows.filter((row) => row.endedAt != null && row.id !== excludeId).map(withAnswerHistory),
      );
    },
    async delete(id) {
      await db.meetings.delete(id);
    },
  };
}

export function createMemoryMeetingRepository(): MeetingRepository {
  const rows = new Map<string, MeetingRecord>();
  return {
    async put(record) {
      rows.set(record.id, structuredClone(record));
    },
    async get(id) {
      const row = rows.get(id);
      return row ? withAnswerHistory(structuredClone(row)) : null;
    },
    async list() {
      return newestFirst([...rows.values()].map((row) => withAnswerHistory(structuredClone(row))));
    },
    async listPast(excludeId) {
      return newestFirst(
        [...rows.values()]
          .filter((row) => row.endedAt != null && row.id !== excludeId)
          .map((row) => withAnswerHistory(structuredClone(row))),
      );
    },
    async delete(id) {
      rows.delete(id);
    },
  };
}

let repository: MeetingRepository | null = null;

onAccountUnbind(() => {
  repository = null;
});

export function getMeetingRepository(): MeetingRepository {
  if (repository) return repository;
  const accountId = currentAccountId();
  repository = accountId
    ? createDexieMeetingRepository(contextDatabaseName(accountId))
    : createMemoryMeetingRepository();
  return repository;
}

export function setMeetingRepository(next: MeetingRepository | null): void {
  repository = next;
}
