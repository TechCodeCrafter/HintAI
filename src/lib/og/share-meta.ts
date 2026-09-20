import { MEETHINT_DOMAIN } from "@/lib/brand";
import site from "./site.json";

/** Absolute OG image for share cards (custom public/og.jpg on meethint.ai). */
export const MEETHINT_OG_IMAGE = `https://www.${MEETHINT_DOMAIN}/og.jpg`;

/**
 * Share-card meta rendered by React `<head>` on meethint.ai.
 * Post-SSR head injection breaks hydration — these tags must live in the route tree.
 */
export function shareOgHeadMeta() {
  const title = site.title?.trim() || "MeetHint";
  const description = site.description?.trim() || "";
  return [
    { name: "twitter:card", content: "summary_large_image" },
    { property: "og:title", content: title },
    ...(description ? [{ property: "og:description", content: description }] : []),
    { property: "og:image", content: MEETHINT_OG_IMAGE },
    { property: "og:image:alt", content: "Hint — listen · cite · say" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:title", content: title },
  ] as const;
}
