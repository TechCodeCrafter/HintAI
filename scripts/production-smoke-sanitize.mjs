/**
 * Strip provider secrets from Playwright storage-state JSON before persisting.
 * OAuth session cookies are kept; LLM API keys must be injected at smoke runtime.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** localStorage keys that must never appear in saved smoke auth state. */
export const STRIPPED_LOCAL_STORAGE_PREFIXES = [
  "meethint.providerKeys",
  "ground.pack",
  "meethint.flightLog",
];

const FORBIDDEN_VALUE_PATTERNS = [
  /\bsk-[a-zA-Z0-9]{10,}/,
  /\bxai-[a-zA-Z0-9]{10,}/,
  /\bapi[_-]?key\s*[:=]/i,
];

export function shouldStripLocalStorageKey(name) {
  return STRIPPED_LOCAL_STORAGE_PREFIXES.some(
    (prefix) => name === prefix || name.startsWith(`${prefix}.`),
  );
}

/** Playwright rejects __Host- cookies saved with a domain attribute — use url instead. */
export function normalizePlaywrightCookies(cookies) {
  return cookies.map((cookie) => {
    if (!cookie.name.startsWith("__Host-")) return cookie;
    const path = cookie.path ?? "/";
    const host = cookie.domain?.replace(/^\./, "") ?? "www.meethint.ai";
    const { domain, path: _path, ...rest } = cookie;
    return {
      ...rest,
      url: `https://${host}${path.startsWith("/") ? path : `/${path}`}`,
    };
  });
}

export function sanitizeStorageStatePayload(state) {
  const next = { cookies: normalizePlaywrightCookies(state.cookies ?? []) };
  if (Array.isArray(state.origins)) {
    next.origins = state.origins.map((origin) => ({
      ...origin,
      localStorage: (origin.localStorage ?? []).filter(
        (entry) => !shouldStripLocalStorageKey(entry.name),
      ),
      sessionStorage: (origin.sessionStorage ?? []).filter(
        (entry) => !shouldStripLocalStorageKey(entry.name),
      ),
    }));
  }
  return next;
}

export function assertStorageStateSafe(jsonText, label = "storage state") {
  for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
    if (pattern.test(jsonText)) {
      throw new Error(`${label} contains a forbidden secret pattern (${pattern})`);
    }
  }
  for (const prefix of STRIPPED_LOCAL_STORAGE_PREFIXES) {
    const keyPattern = new RegExp(`"name"\\s*:\\s*"${prefix.replace(".", "\\.")}[^"]*"`);
    if (keyPattern.test(jsonText)) {
      throw new Error(`${label} still contains stripped key prefix ${prefix}`);
    }
  }
}

export function sanitizeStorageStateFile(path) {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  const sanitized = sanitizeStorageStatePayload(parsed);
  const json = JSON.stringify(sanitized, null, 2);
  assertStorageStateSafe(json, path);
  writeFileSync(path, json);
  return { cookieCount: sanitized.cookies.length, originCount: sanitized.origins?.length ?? 0 };
}
