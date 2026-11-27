import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Card } from "@/lib/repo/types";
import { evidenceKey } from "@/lib/search/why-answer";
import {
  HOVER_CLOSE_MS,
  HOVER_OPEN_MS,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP_PX,
  readEvidenceOpen,
  writeEvidenceOpen,
} from "@/lib/ui/evidence-open";

export type EvidenceCardFields = Pick<Card, "say" | "evidence" | "parts" | "query">;

export type EvidenceView = {
  /** The evidence is showing, for either reason below. */
  open: boolean;
  /** Opened on purpose (click, keyboard, long press). Stays until closed, and through a reload. */
  pinned: boolean;
  /** Open, close or toggle the pinned state. */
  setPinned: (next: boolean | ((was: boolean) => boolean)) => void;
};

export const EvidenceViewContext = createContext<EvidenceView | null>(null);

/**
 * The evidence view of the card this is rendered under, or null when the card
 * was not wrapped in an `EvidenceCard`.
 */
export function useEvidenceViewContext(): EvidenceView | null {
  return useContext(EvidenceViewContext);
}

/**
 * Whether the last pointer move went somewhere. A browser re-sends a move at
 * the same spot when the page under a resting pointer changes; that is the
 * page moving, not the person, and it must not open anything.
 */
let lastX = Number.NaN;
let lastY = Number.NaN;
let lastMoveWasReal = false;
let watching = false;

function watchPointer() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener(
    "pointermove",
    (event) => {
      lastMoveWasReal = event.clientX !== lastX || event.clientY !== lastY;
      lastX = event.clientX;
      lastY = event.clientY;
    },
    { capture: true, passive: true },
  );
}

/**
 * Open state for one card's evidence view.
 *
 * Both states are held as the name of the answer they belong to, not as a
 * flag. A new answer has a new name, so its view starts closed with no effect
 * to run and no frame where the old state shows: the next answer is never
 * held up by, or hidden under, the one before it.
 */
export function useEvidenceView(card: EvidenceCardFields | null | undefined) {
  const key = useMemo(() => evidenceKey(card), [card]);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [peekKey, setPeekKey] = useState<string | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** A long press opened the view, and that finger has not been followed by a new touch yet. */
  const pressFired = useRef(false);
  /** Until when the click that ends a long press is swallowed. */
  const swallowClickUntil = useRef(0);
  /** Closed on purpose with the pointer still on the card: stay closed until it leaves. */
  const hoverHeld = useRef(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  // Storage is read after mount so the server render and the first client
  // render agree.
  useEffect(() => {
    setPinnedKey(readEvidenceOpen());
    watchPointer();
  }, []);

  const clear = (ref: { current: number | null }) => {
    if (ref.current != null) window.clearTimeout(ref.current);
    ref.current = null;
  };
  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(
    () => () => {
      clear(openTimer);
      clear(closeTimer);
      endPress();
    },
    [],
  );

  const pinned = key != null && pinnedKey === key;
  const open = key != null && (pinned || peekKey === key);

  const setPinned = useCallback<EvidenceView["setPinned"]>((next) => {
    const current = keyRef.current;
    if (!current) return;
    setPinnedKey((was) => {
      const value = typeof next === "function" ? next(was === current) : next;
      const now = value ? current : null;
      writeEvidenceOpen(now);
      // Closing on purpose closes a hover-opened view too, and the pointer
      // still resting on the card does not reopen it.
      if (!value) hoverHeld.current = true;
      return now;
    });
    // A hover that was about to open it is overtaken by the click.
    if (openTimer.current != null) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    setPeekKey(null);
  }, []);

  const view = useMemo<EvidenceView>(() => ({ open, pinned, setPinned }), [open, pinned, setPinned]);

  const cardProps = {
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      if (event.pointerType === "mouse") {
        if (!lastMoveWasReal) return;
        clear(closeTimer);
        if (hoverHeld.current) return;
        if (!keyRef.current || peekKey === keyRef.current || openTimer.current != null) return;
        const target = keyRef.current;
        openTimer.current = window.setTimeout(() => {
          openTimer.current = null;
          // Only if the card under the pointer is still the one it came to rest on.
          if (keyRef.current === target && !hoverHeld.current) setPeekKey(target);
        }, HOVER_OPEN_MS);
        return;
      }
      const held = press.current;
      if (held && Math.hypot(event.clientX - held.x, event.clientY - held.y) > LONG_PRESS_SLOP_PX) endPress();
    },
    onPointerLeave(event: ReactPointerEvent<HTMLElement>) {
      if (event.pointerType !== "mouse") {
        endPress();
        return;
      }
      hoverHeld.current = false;
      clear(openTimer);
      clear(closeTimer);
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        setPeekKey(null);
      }, HOVER_CLOSE_MS);
    },
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      pressFired.current = false;
      if (event.pointerType === "mouse" || !keyRef.current) return;
      // Inside the evidence itself a held finger selects text, as anywhere else.
      if ((event.target as Element | null)?.closest?.("[data-evidence-body]")) return;
      endPress();
      const target = keyRef.current;
      const timer = window.setTimeout(() => {
        press.current = null;
        if (keyRef.current !== target) return;
        pressFired.current = true;
        window.getSelection?.()?.removeAllRanges();
        setPinned(true);
      }, LONG_PRESS_MS);
      press.current = { timer, x: event.clientX, y: event.clientY };
    },
    onPointerUp() {
      endPress();
      if (pressFired.current) swallowClickUntil.current = Date.now() + 400;
    },
    onPointerCancel: endPress,
    // The press that opened the evidence should not also follow a link or
    // raise the browser's own long-press menu.
    onClickCapture(event: { preventDefault: () => void; stopPropagation: () => void }) {
      if (Date.now() >= swallowClickUntil.current) return;
      swallowClickUntil.current = 0;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu(event: { preventDefault: () => void }) {
      if (press.current || pressFired.current) event.preventDefault();
    },
  };

  return { view, cardProps, key };
}
