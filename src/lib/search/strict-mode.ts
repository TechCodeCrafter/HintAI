const STRICT_MODE_KEY = "meethint.strictMode";

/**
 * Strict mode: when true, the answer pipeline stays pure cite-or-silence and
 * skips the general-knowledge fallback. Stored in this browser only.
 */
export function readStrictMode(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(STRICT_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeStrictMode(enabled: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled) localStorage.setItem(STRICT_MODE_KEY, "1");
    else localStorage.removeItem(STRICT_MODE_KEY);
  } catch {
    // Storage unavailable — strict mode simply stays off.
  }
}
