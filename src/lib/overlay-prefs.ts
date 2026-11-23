/**
 * Where the second screen sits and how strongly it shows.
 *
 * Kept on the device, not in the account: it describes this screen. Both the
 * live window and the /relay page read it, and a change made in one window
 * reaches the others through the storage event.
 *
 * What a web page can and cannot do here: it can choose where its own pop-up
 * window opens and how faint its own content is drawn. It cannot make the
 * browser window see-through or keep it above other apps.
 */
export const OVERLAY_PREFS_KEY = "meethint.overlayPrefs";

export const OVERLAY_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center"] as const;
export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

export type OverlayPrefs = {
  position: OverlayPosition;
  /** 1 is solid. Never below OVERLAY_MIN_OPACITY, so the card stays readable. */
  opacity: number;
};

export const OVERLAY_MIN_OPACITY = 0.4;
/** Top right: clear of the shared content and of the controls most meeting apps keep at the bottom. */
export const OVERLAY_DEFAULTS: OverlayPrefs = { position: "top-right", opacity: 1 };

export const LIVE_WINDOW_SIZE = { width: 440, height: 640 };
const MARGIN = 16;

export function clampOpacity(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return OVERLAY_DEFAULTS.opacity;
  return Math.round(Math.min(1, Math.max(OVERLAY_MIN_OPACITY, n)) * 100) / 100;
}

export function normalizeOverlayPrefs(value: unknown): OverlayPrefs {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof OverlayPrefs, unknown>>;
  const position = OVERLAY_POSITIONS.find((item) => item === raw.position) ?? OVERLAY_DEFAULTS.position;
  return { position, opacity: raw.opacity === undefined ? OVERLAY_DEFAULTS.opacity : clampOpacity(raw.opacity) };
}

type PrefStore = Pick<Storage, "getItem" | "setItem">;

function deviceStorage(): PrefStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readOverlayPrefs(storage: PrefStore | null = deviceStorage()): OverlayPrefs {
  try {
    const raw = storage?.getItem(OVERLAY_PREFS_KEY);
    return raw ? normalizeOverlayPrefs(JSON.parse(raw)) : OVERLAY_DEFAULTS;
  } catch {
    return OVERLAY_DEFAULTS;
  }
}

export function writeOverlayPrefs(prefs: OverlayPrefs, storage: PrefStore | null = deviceStorage()): OverlayPrefs {
  const next = normalizeOverlayPrefs(prefs);
  try {
    storage?.setItem(OVERLAY_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* private mode or full storage: the choice lasts for this page only */
  }
  return next;
}

export type ScreenArea = { availWidth: number; availHeight: number; availLeft?: number; availTop?: number };

/** Top-left corner of a window of `size` placed at `position` on the usable screen. */
export function liveWindowOrigin(
  position: OverlayPosition,
  screen: ScreenArea,
  size = LIVE_WINDOW_SIZE,
): { left: number; top: number } {
  const x0 = screen.availLeft ?? 0;
  const y0 = screen.availTop ?? 0;
  const maxLeft = Math.max(0, screen.availWidth - size.width);
  const maxTop = Math.max(0, screen.availHeight - size.height);
  const near = (max: number) => Math.min(MARGIN, max);
  const far = (max: number) => Math.max(0, max - MARGIN);
  const left = position === "center" ? maxLeft / 2 : position.endsWith("left") ? near(maxLeft) : far(maxLeft);
  const top = position === "center" ? maxTop / 2 : position.startsWith("top") ? near(maxTop) : far(maxTop);
  return { left: Math.round(x0 + left), top: Math.round(y0 + top) };
}

/** The `window.open` feature string for the live window. */
export function liveWindowFeatures(prefs: OverlayPrefs, screen: ScreenArea, size = LIVE_WINDOW_SIZE): string {
  const { left, top } = liveWindowOrigin(prefs.position, screen, size);
  return `popup,width=${size.width},height=${size.height},left=${left},top=${top}`;
}
