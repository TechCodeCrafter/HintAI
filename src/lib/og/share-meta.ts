import {
  MEETHINT_CANONICAL_URL,
  MEETHINT_NAME,
  MEETHINT_OG_DESCRIPTION,
  MEETHINT_OG_IMAGE,
  MEETHINT_OG_IMAGE_ALT,
  MEETHINT_OG_TITLE,
  MEETHINT_TWITTER_DESCRIPTION,
} from "../brand.ts";

export { MEETHINT_CANONICAL_URL, MEETHINT_OG_IMAGE, MEETHINT_OG_IMAGE_ALT };

/**
 * Authoritative share-card meta for the marketing homepage (SSR via `__root.tsx`).
 * Do not duplicate these tags in static HTML, client effects, or the Grok PWA
 * injector — MeetHint hosts skip stream injection (`shouldStreamInjectHead`).
 */
export function shareOgHeadMeta() {
  return [
    { property: "og:title", content: MEETHINT_OG_TITLE },
    { property: "og:description", content: MEETHINT_OG_DESCRIPTION },
    { property: "og:type", content: "website" },
    { property: "og:url", content: MEETHINT_CANONICAL_URL },
    { property: "og:site_name", content: MEETHINT_NAME },
    { property: "og:image", content: MEETHINT_OG_IMAGE },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: MEETHINT_OG_IMAGE_ALT },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: MEETHINT_OG_TITLE },
    { name: "twitter:description", content: MEETHINT_TWITTER_DESCRIPTION },
    { name: "twitter:image", content: MEETHINT_OG_IMAGE },
  ] as const;
}
