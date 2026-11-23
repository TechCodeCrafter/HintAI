import { useCallback, useEffect, useState } from "react";
import {
  OVERLAY_DEFAULTS,
  OVERLAY_MIN_OPACITY,
  OVERLAY_POSITIONS,
  OVERLAY_PREFS_KEY,
  type OverlayPosition,
  type OverlayPrefs,
  liveWindowOrigin,
  readOverlayPrefs,
  writeOverlayPrefs,
} from "@/lib/overlay-prefs";

const LABELS: Record<OverlayPosition, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
  center: "Center",
};

/** The second-screen settings, shared by every window on this device. */
export function useOverlayPrefs(): [OverlayPrefs, (next: Partial<OverlayPrefs>) => void] {
  // Defaults on the first render so the server and the browser agree.
  const [prefs, setPrefs] = useState<OverlayPrefs>(OVERLAY_DEFAULTS);
  useEffect(() => {
    setPrefs(readOverlayPrefs());
    const onStorage = (event: StorageEvent) => {
      if (event.key === OVERLAY_PREFS_KEY || event.key === null) setPrefs(readOverlayPrefs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const update = useCallback((next: Partial<OverlayPrefs>) => {
    setPrefs((current) => writeOverlayPrefs({ ...current, ...next }));
  }, []);
  return [prefs, update];
}

/**
 * Moves this window to the chosen corner when it is the live pop-up. A normal
 * tab cannot be moved by its page, and the browser ignores the call there.
 */
function moveLiveWindow(position: OverlayPosition) {
  if (typeof window === "undefined" || !window.opener) return;
  try {
    const { left, top } = liveWindowOrigin(position, window.screen, {
      width: window.outerWidth,
      height: window.outerHeight,
    });
    window.moveTo(left, top);
  } catch {
    /* not a window the page may move */
  }
}

export function OverlayPrefsControl({
  prefs,
  onChange,
  className,
}: {
  prefs: OverlayPrefs;
  onChange: (next: Partial<OverlayPrefs>) => void;
  className?: string;
}) {
  const percent = Math.round(prefs.opacity * 100);
  return (
    <div className={`overlay-prefs ${className ?? ""}`} data-testid="overlay-prefs">
      <label className="overlay-prefs-field">
        <span>Position</span>
        <select
          value={prefs.position}
          data-testid="overlay-position"
          onChange={(event) => {
            const position = event.target.value as OverlayPosition;
            onChange({ position });
            moveLiveWindow(position);
          }}
        >
          {OVERLAY_POSITIONS.map((position) => (
            <option key={position} value={position}>
              {LABELS[position]}
            </option>
          ))}
        </select>
      </label>
      <label className="overlay-prefs-field">
        <span>Opacity</span>
        <input
          type="range"
          min={Math.round(OVERLAY_MIN_OPACITY * 100)}
          max={100}
          step={5}
          value={percent}
          data-testid="overlay-opacity"
          aria-valuetext={`${percent} percent`}
          onChange={(event) => onChange({ opacity: Number(event.target.value) / 100 })}
        />
        <span className="tabular-nums" data-testid="overlay-opacity-value">
          {percent}%
        </span>
      </label>
    </div>
  );
}
