import { readAccountStorage, writeAccountStorage } from "@/lib/auth/account-boundary";
import type { Card } from "@/lib/repo/types";

export const SESSION_KEY = "meethint.session";
const SESSION_KEY_LEGACY = "ground.session";

export type SessionWire = {
  card: Card | null;
  armed: boolean;
  listening: boolean;
  searching: boolean;
};

function readSessionRaw(): string | null {
  const next = readAccountStorage(SESSION_KEY);
  if (next != null) return next;
  try {
    const legacy = localStorage.getItem(SESSION_KEY_LEGACY);
    if (legacy == null) return null;
    writeAccountStorage(SESSION_KEY, legacy);
    localStorage.removeItem(SESSION_KEY_LEGACY);
    return legacy;
  } catch {
    return null;
  }
}

export function persistSessionWire(partial: SessionWire) {
  writeAccountStorage(SESSION_KEY, JSON.stringify(partial));
  try {
    localStorage.removeItem(SESSION_KEY_LEGACY);
  } catch {
    /* ignore quota */
  }
}

export function readRelaySession(): SessionWire | null {
  try {
    const raw = readSessionRaw();
    if (!raw) return null;
    return JSON.parse(raw) as SessionWire;
  } catch {
    return null;
  }
}
