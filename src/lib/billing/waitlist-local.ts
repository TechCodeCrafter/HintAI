import Dexie, { type Table } from "dexie";
import { joinWaitlist } from "@/lib/waitlist";

export { isWaitlistEmail } from "./waitlist-email.ts";
import { isWaitlistEmail } from "./waitlist-email.ts";

export type WaitlistSignup = {
  email: string;
  source: string;
  createdAt: number;
};

class WaitlistDatabase extends Dexie {
  waitlist!: Table<WaitlistSignup, string>;

  constructor() {
    super("meethint-waitlist");
    this.version(1).stores({ waitlist: "email, source, createdAt" });
  }
}

let db: WaitlistDatabase | null = null;

function getDb(): WaitlistDatabase {
  db ??= new WaitlistDatabase();
  return db;
}

export async function hasWaitlistSignup(): Promise<boolean> {
  try {
    return (await getDb().waitlist.count()) > 0;
  } catch {
    return false;
  }
}

export async function recordWaitlistSignup(email: string, source: string): Promise<void> {
  await getDb().waitlist.put({
    email: email.trim().toLowerCase(),
    source,
    createdAt: Date.now(),
  });
}

export async function joinProWaitlist(
  email: string,
  source: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isWaitlistEmail(email)) {
    return { ok: false, reason: "That does not look like an email address." };
  }
  const result = await joinWaitlist({ data: { email: email.trim(), source } });
  if (!result.ok) return result;
  await recordWaitlistSignup(email, source).catch(() => undefined);
  return { ok: true };
}
