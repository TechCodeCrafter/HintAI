/**
 * Detect and strip Cursor-generated git commit attribution only.
 * Human Co-authored-by trailers are preserved.
 */

/** Known Cursor agent email addresses (lowercase). */
export const CURSOR_AGENT_EMAILS = new Set([
  "cursoragent@cursor.com",
  "cursor@cursor.com",
]);

/** Author names Cursor uses for machine attribution (exact match, case-insensitive). */
const CURSOR_AUTHOR_NAMES = /^cursor(\s+agent)?$/i;

/**
 * True when a commit-message line is Cursor-generated attribution.
 * Does not match human co-authors, including names that merely contain "cursor".
 */
export function isCursorAttributionLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (/^Made-with:\s*Cursor\s*$/i.test(trimmed)) return true;

  const trailer = trimmed.match(/^(Co-authored-by|Authored-by):\s*(.+?)\s*<([^>]+)>\s*$/i);
  if (!trailer) return false;

  const name = trailer[2].trim();
  const email = trailer[3].trim().toLowerCase();

  if (CURSOR_AUTHOR_NAMES.test(name)) return true;
  if (CURSOR_AGENT_EMAILS.has(email)) return true;

  return false;
}

/** Remove Cursor attribution lines; preserve human co-authors and message body. */
export function stripCursorAttribution(message) {
  const kept = message.split("\n").filter((line) => !isCursorAttributionLine(line));
  if (kept.length === 0) return "\n";
  const body = kept.join("\n").replace(/\n+$/, "");
  return body.length === 0 ? "\n" : `${body}\n`;
}

/** Scan a full commit message; returns offending lines (for CI). */
export function findCursorAttributionLines(message) {
  return message.split("\n").filter((line) => isCursorAttributionLine(line));
}
