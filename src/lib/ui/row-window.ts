/** Height of one row and the gap under it, in pixels. A windowed list is laid out from this. */
export const FILE_ROW_HEIGHT = 48;
/** A list longer than this draws only the rows on screen. */
export const WINDOW_FROM = 200;
/** Rows drawn above and below the ones on screen, so a scroll does not show a gap. */
export const OVERSCAN = 8;

/** The rows to draw for a scroll position: `[start, end)`. */
export function rowWindow(scrollTop: number, height: number, count: number): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / FILE_ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(count, Math.ceil((scrollTop + height) / FILE_ROW_HEIGHT) + OVERSCAN);
  return { start: Math.min(start, end), end };
}
