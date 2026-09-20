/** Single user-facing product name — use everywhere customers see the app. */
export const MEETHINT_NAME = "MeetHint";

/** Short wordmark in landing chrome and CTAs (domain remains meethint.ai). */
export const MEETHINT_MARK = "Hint";

export const MEETHINT_DOMAIN = "meethint.ai";

/** Public GitHub repository (security reporting + general contact for Phase A). */
export const MEETHINT_REPO = "https://github.com/TechCodeCrafter/HintAI";

export const MEETHINT_SECURITY_CONTACT = `${MEETHINT_REPO}/security/advisories/new`;

export const MEETHINT_SUPPORT_CONTACT = `${MEETHINT_REPO}/issues`;

/** Document `<title>` and default meta description for marketing / root routes. */
export const MEETHINT_TITLE = `${MEETHINT_NAME} — Real-time answers for technical conversations`;

export const MEETHINT_DESCRIPTION =
  "MeetHint gives you real-time, cited answers during technical conversations using your repos, docs, and company knowledge.";

/** Open Graph / Twitter card copy (may differ from `<title>` for share previews). */
export const MEETHINT_OG_TITLE = `${MEETHINT_NAME} — Know before you answer`;

export const MEETHINT_OG_DESCRIPTION =
  "Real-time, evidence-backed answers for technical conversations. Grounded in your repos, docs, and company knowledge.";

export const MEETHINT_TWITTER_DESCRIPTION =
  "Real-time answers from your repos, docs, and company knowledge.";

/** Canonical marketing origin — trailing slash matches Meta Sharing Debugger. */
export const MEETHINT_CANONICAL_URL = `https://www.${MEETHINT_DOMAIN}/`;

/**
 * Versioned share-card asset — bump the filename (v2 → v3) when Meta or X cache
 * stale previews after a metadata change.
 */
export const MEETHINT_OG_IMAGE_PATH = "/og/meethint-og-v3.png";

/** Absolute Open Graph / Twitter image URL for the marketing homepage. */
export const MEETHINT_OG_IMAGE = `https://www.${MEETHINT_DOMAIN}${MEETHINT_OG_IMAGE_PATH}`;

export const MEETHINT_OG_IMAGE_ALT =
  "MeetHint social preview showing the official logo and a cited technical answer card";

/** Contract line — design skills must never rewrite or paraphrase in product UI. */
export const MEETHINT_CONTRACT = "Cite or silence.";
