import type { Page } from "@playwright/test";

export type SignupEventCounts = {
  USER_CREATED: number;
  SIGNUP: number;
  SESSION_START: number;
};

export async function countSignupTelemetry(page: Page): Promise<SignupEventCounts> {
  return page.evaluate(() => {
    const counts: SignupEventCounts = { USER_CREATED: 0, SIGNUP: 0, SESSION_START: 0 };
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.includes("betaTelemetry")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      for (const line of raw.split("\n").filter(Boolean)) {
        const row = JSON.parse(line) as { kind?: string; event?: keyof SignupEventCounts };
        if (row.kind !== "event" || !row.event || !(row.event in counts)) continue;
        counts[row.event] += 1;
      }
    }
    return counts;
  });
}

export async function funnelUserCreatedTimestamp(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    let earliest: number | null = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.includes("betaTelemetry")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      for (const line of raw.split("\n").filter(Boolean)) {
        const row = JSON.parse(line) as { kind?: string; event?: string; timestamp?: number };
        if (row.kind !== "event") continue;
        if (row.event !== "USER_CREATED" && row.event !== "SIGNUP") continue;
        if (row.timestamp == null) continue;
        if (earliest == null || row.timestamp < earliest) earliest = row.timestamp;
      }
    }
    return earliest;
  });
}
