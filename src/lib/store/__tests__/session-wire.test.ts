/**
 * The session wire: how a card gets from the cockpit to a second screen.
 *
 * The second screen reads the newest state from storage. It hears about a
 * change from the storage event, and falls back to a short poll. These tests
 * run the reader against a fake window so both paths, and the returns from a
 * reload or a dropped connection, are exercised without a browser.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { ACCOUNT_EPOCH_KEY, bindAccountId } from "../../auth/account-boundary.ts";
import type { Card } from "../../repo/types.ts";
import {
  SESSION_KEY,
  WIRE_POLL_MS,
  type SessionWire,
  isSessionWireKey,
  persistSessionWire,
  readRelaySession,
  sessionWireOrigin,
  watchSessionWire,
} from "../session-wire.ts";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
});

/** A window that fires events and timers only when the test says so. */
function fakeWindow() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const timers = new Map<number, { run: () => void; every: number }>();
  let nextId = 1;
  return {
    target: {
      addEventListener: (type: string, fn: (event: Event) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)?.add(fn);
      },
      removeEventListener: (type: string, fn: (event: Event) => void) => void listeners.get(type)?.delete(fn),
      setInterval: (run: () => void, every: number) => {
        timers.set(nextId, { run, every });
        return nextId++;
      },
      clearInterval: (id: number) => void timers.delete(id),
    } as unknown as Window,
    fire: (type: string, init: Record<string, unknown> = {}) =>
      listeners.get(type)?.forEach((fn) => fn({ type, ...init } as unknown as Event)),
    tick: () => timers.forEach((timer) => timer.run()),
    intervals: () => [...timers.values()].map((timer) => timer.every),
    listening: () => [...listeners.entries()].filter(([, set]) => set.size > 0).map(([type]) => type).sort(),
  };
}

function card(say: string): Card {
  return { say, citations: [], query: "q", latencyMs: 1, source: "local" };
}

const idle = { armed: false, listening: false, searching: false };

beforeEach(() => {
  store.clear();
  bindAccountId("user-a");
});

test("every write is stamped with a rising sequence, the time, the tab and the space", () => {
  persistSessionWire({ card: card("one"), ...idle, spaceId: "space-1" }, 1000);
  persistSessionWire({ card: card("two"), ...idle, spaceId: "space-1" }, 1500);
  const wire = readRelaySession();
  assert.equal(wire?.card?.say, "two");
  assert.equal(wire?.seq, 2);
  assert.equal(wire?.at, 1500);
  assert.equal(wire?.origin, sessionWireOrigin());
  assert.equal(wire?.spaceId, "space-1");
  persistSessionWire({ card: null, ...idle }, 1600);
  assert.equal(readRelaySession()?.seq, 3);
  assert.equal(readRelaySession()?.spaceId, null);
});

test("the session is stored under the account, and that is the key a storage event carries", () => {
  persistSessionWire({ card: card("one"), ...idle });
  assert.deepEqual([...store.keys()], [`${SESSION_KEY}.user-a`]);
  assert.equal(isSessionWireKey(`${SESSION_KEY}.user-a`), true);
  // The bare key is another account's session (the local dev account).
  assert.equal(isSessionWireKey(SESSION_KEY), false);
  assert.equal(isSessionWireKey(`${SESSION_KEY}.user-b`), false);
  assert.equal(isSessionWireKey("meethint.theme"), false);
  // Sign-in and sign-out change which session is the right one; a clear wipes it.
  assert.equal(isSessionWireKey(ACCOUNT_EPOCH_KEY), true);
  assert.equal(isSessionWireKey(null), true);
  bindAccountId("dev-user");
  assert.equal(isSessionWireKey(SESSION_KEY), true);
});

test("a second screen shows a new card on the storage event, without waiting for the poll", () => {
  const win = fakeWindow();
  const seen: Array<string | null> = [];
  const stop = watchSessionWire((wire) => seen.push(wire?.card?.say ?? null), { target: win.target });
  assert.deepEqual(seen, [null]);

  persistSessionWire({ card: card("first answer"), ...idle });
  win.fire("storage", { key: `${SESSION_KEY}.user-a` });
  assert.deepEqual(seen, [null, "first answer"]);

  // An event for some other key is not a reason to read the session again.
  persistSessionWire({ card: card("second answer"), ...idle });
  win.fire("storage", { key: "meethint.theme" });
  assert.deepEqual(seen, [null, "first answer"]);
  stop();
});

test("when no storage event arrives the poll picks the card up, well inside 800 ms", () => {
  assert.ok(WIRE_POLL_MS <= 400, "two polls must fit inside the 800 ms budget");
  const win = fakeWindow();
  const seen: Array<string | null> = [];
  const stop = watchSessionWire((wire) => seen.push(wire?.card?.say ?? null), { target: win.target });
  assert.deepEqual(win.intervals(), [WIRE_POLL_MS]);
  persistSessionWire({ card: card("polled"), ...idle });
  win.tick();
  assert.deepEqual(seen, [null, "polled"]);
  stop();
});

test("an unchanged session is not handed over again", () => {
  const win = fakeWindow();
  persistSessionWire({ card: card("same"), ...idle });
  const seen: SessionWire[] = [];
  const stop = watchSessionWire((wire) => wire && seen.push(wire), { target: win.target });
  win.tick();
  win.tick();
  win.fire("storage", { key: `${SESSION_KEY}.user-a` });
  assert.equal(seen.length, 1);
  stop();
});

test("a second screen opened or reloaded late starts on the card that is already there", () => {
  persistSessionWire({ card: card("answered before the reload"), ...idle });
  const win = fakeWindow();
  const seen: Array<string | null> = [];
  const stop = watchSessionWire((wire) => seen.push(wire?.card?.say ?? null), { target: win.target });
  assert.deepEqual(seen, ["answered before the reload"]);
  stop();
});

test("cards answered while the second screen was away are caught up on return, newest only", () => {
  for (const back of ["online", "pageshow", "visibilitychange"]) {
    store.clear();
    const win = fakeWindow();
    const seen: Array<[string | null, number | undefined]> = [];
    const stop = watchSessionWire((wire) => seen.push([wire?.card?.say ?? null, wire?.seq]), { target: win.target });
    // Three answers land with no event and no timer reaching this screen.
    persistSessionWire({ card: card("one"), ...idle });
    persistSessionWire({ card: card("two"), ...idle });
    persistSessionWire({ card: card("three"), ...idle });
    win.fire(back);
    assert.deepEqual(seen, [[null, undefined], ["three", 3]], back);
    stop();
  }
});

test("the account binding arriving after the page does not leave the screen empty", () => {
  persistSessionWire({ card: card("for user a"), ...idle });
  bindAccountId(null);
  const win = fakeWindow();
  const seen: Array<string | null> = [];
  const stop = watchSessionWire((wire) => seen.push(wire?.card?.say ?? null), { target: win.target });
  assert.deepEqual(seen, [null]);
  bindAccountId("user-a");
  win.tick();
  assert.deepEqual(seen, [null, "for user a"]);
  stop();
});

test("a signed-out screen stops showing the last account's card", () => {
  persistSessionWire({ card: card("for user a"), ...idle });
  const win = fakeWindow();
  const seen: Array<string | null> = [];
  const stop = watchSessionWire((wire) => seen.push(wire?.card?.say ?? null), { target: win.target });
  bindAccountId("user-b");
  win.fire("storage", { key: ACCOUNT_EPOCH_KEY });
  assert.deepEqual(seen, ["for user a", null]);
  stop();
});

test("a session that cannot be parsed reads as no session", () => {
  store.set(`${SESSION_KEY}.user-a`, "{not json");
  assert.equal(readRelaySession(), null);
  // And the next write starts the sequence again instead of failing.
  persistSessionWire({ card: card("after"), ...idle });
  assert.equal(readRelaySession()?.seq, 1);
});

test("stopping the watch removes every listener and the timer", () => {
  const win = fakeWindow();
  const stop = watchSessionWire(() => {}, { target: win.target });
  assert.deepEqual(win.listening(), ["online", "pageshow", "storage", "visibilitychange"]);
  stop();
  assert.deepEqual(win.listening(), []);
  assert.deepEqual(win.intervals(), []);
});
