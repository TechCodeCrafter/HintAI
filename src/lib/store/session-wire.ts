import { ACCOUNT_EPOCH_KEY, accountStorageKey, readAccountStorage, writeAccountStorage } from "../auth/account-boundary.ts";
import type { Card } from "@/lib/repo/types";

export const SESSION_KEY = "meethint.session";
const SESSION_KEY_LEGACY = "ground.session";

/**
 * How often a second screen re-reads the wire when no storage event reaches
 * it. Storage events are the fast path and arrive in a few milliseconds; this
 * is the floor under them, and it keeps the worst case well inside the 800 ms
 * a card is allowed to take to show up.
 */
export const WIRE_POLL_MS = 250;

/** What the cockpit says about the session. */
export type SessionState = {
  card: Card | null;
  armed: boolean;
  listening: boolean;
  searching: boolean;
  /** The Knowledge Space the card was answered from. Null on the demo pack. */
  spaceId?: string | null;
};

/**
 * The session as it sits in storage for a second screen to read. The wire
 * always holds the newest state, so a reader that was away (reloaded, asleep,
 * offline) is current again on its next read: there is no queue to fall
 * behind on.
 */
export type SessionWire = SessionState & {
  /** Goes up by one on every write, so a reader can tell a new card from the one it has. */
  seq?: number;
  /** When this state was written, which for a card is when the answer was ready. */
  at?: number;
  /** The tab that wrote it. */
  origin?: string;
};

/** What a writer hands over: the session, and the space its card belongs to. */
export type SessionWrite = SessionState & { spaceId?: string | null };

const TAB_ID = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** This tab's name on the wire. A reader uses it to skip what it wrote itself. */
export function sessionWireOrigin(): string {
  return TAB_ID;
}

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

function parse(raw: string | null): SessionWire | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionWire;
  } catch {
    return null;
  }
}

export function persistSessionWire(state: SessionWrite, now = Date.now()) {
  const previous = parse(readAccountStorage(SESSION_KEY));
  const wire: SessionWire = {
    card: state.card,
    armed: state.armed,
    listening: state.listening,
    searching: state.searching,
    spaceId: state.spaceId ?? null,
    seq: (previous?.seq ?? 0) + 1,
    at: now,
    origin: TAB_ID,
  };
  writeAccountStorage(SESSION_KEY, JSON.stringify(wire));
  try {
    localStorage.removeItem(SESSION_KEY_LEGACY);
  } catch {
    /* ignore quota */
  }
}

export function readRelaySession(): SessionWire | null {
  return parse(readSessionRaw());
}

/**
 * Is this storage event about the session? The session is stored under a key
 * that carries the account, so the bare key only matches the local dev
 * account. A null key means storage was cleared.
 */
export function isSessionWireKey(key: string | null): boolean {
  if (key === null) return true;
  return key === accountStorageKey(SESSION_KEY) || key === SESSION_KEY_LEGACY || key === ACCOUNT_EPOCH_KEY;
}

type WireTarget = Pick<Window, "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval">;

/**
 * Calls `onWire` with the session now, and again each time it changes.
 *
 * A change is picked up from the storage event when one arrives, and from the
 * poll when it does not. The wire is also re-read when the page comes back
 * (shown again, restored from the back/forward cache, back online), so a
 * second screen that was away shows the newest card as soon as it returns.
 */
export function watchSessionWire(
  onWire: (wire: SessionWire | null) => void,
  options: { pollMs?: number; target?: WireTarget } = {},
): () => void {
  const target = options.target ?? window;
  let last: string | null | undefined;
  const pull = () => {
    const raw = readSessionRaw();
    if (raw === last) return;
    last = raw;
    onWire(parse(raw));
  };
  const onStorage = (event: Event) => {
    if (isSessionWireKey((event as StorageEvent).key ?? null)) pull();
  };
  pull();
  target.addEventListener("storage", onStorage);
  target.addEventListener("online", pull);
  target.addEventListener("pageshow", pull);
  target.addEventListener("visibilitychange", pull);
  const id = target.setInterval(pull, options.pollMs ?? WIRE_POLL_MS);
  return () => {
    target.removeEventListener("storage", onStorage);
    target.removeEventListener("online", pull);
    target.removeEventListener("pageshow", pull);
    target.removeEventListener("visibilitychange", pull);
    target.clearInterval(id);
  };
}
