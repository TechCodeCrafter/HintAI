/**
 * Which answer's evidence view was left open, kept for the tab.
 *
 * One key, one value: the name of the answer (`evidenceKey`). Session storage
 * is per tab and outlives a reload, which is the lifetime wanted here: the
 * cockpit and the second screen each remember their own, and a new tab starts
 * closed. Only the name is stored, never the question or any file text.
 *
 * Every call tolerates storage being unavailable (private mode, a blocked
 * frame): the view then still opens and closes, and a reload starts closed.
 */
export const EVIDENCE_OPEN_KEY = "meethint.evidenceOpen";

/** How long the pointer rests on a card before its evidence opens. */
export const HOVER_OPEN_MS = 160;
/** How long after the pointer leaves before a hover-opened view closes. */
export const HOVER_CLOSE_MS = 260;
/** How long a finger is held on a card before its evidence opens. */
export const LONG_PRESS_MS = 500;
/** A finger that travels further than this is scrolling, not pressing. */
export const LONG_PRESS_SLOP_PX = 10;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function tabStorage(): Store | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The answer whose evidence view was left open, or null. */
export function readEvidenceOpen(store: Store | null = tabStorage()): string | null {
  try {
    return store?.getItem(EVIDENCE_OPEN_KEY) || null;
  } catch {
    return null;
  }
}

/** Remember `key` as open, or forget it with null. */
export function writeEvidenceOpen(key: string | null, store: Store | null = tabStorage()): void {
  try {
    if (key) store?.setItem(EVIDENCE_OPEN_KEY, key);
    else store?.removeItem(EVIDENCE_OPEN_KEY);
  } catch {
    /* Storage is full or blocked. The view still works for this page load. */
  }
}
