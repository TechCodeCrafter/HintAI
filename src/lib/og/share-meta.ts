import {
  MEETHINT_CANONICAL_URL,
  MEETHINT_DOMAIN,
  MEETHINT_NAME,
  MEETHINT_OG_DESCRIPTION,
  MEETHINT_OG_TITLE,
  MEETHINT_TWITTER_DESCRIPTION,
} from "@/lib/brand";

export { MEETHINT_CANONICAL_URL };

/** Absolute OG image for share cards (public/og/meethint-og.png). */
export const MEETHINT_OG_IMAGE = `https://www.${MEETHINT_DOMAIN}/og/meethint-og.png`;

export const MEETHINT_OG_IMAGE_ALT =
  "MeetHint — real-time answers for technical conversations";

/**
 * Share-card meta rendered in SSR `<head>` on meethint.ai.
 * Post-SSR head injection breaks hydration — these tags must live in the route tree.
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
