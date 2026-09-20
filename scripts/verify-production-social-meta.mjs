#!/usr/bin/env node
/**
 * Verify live homepage HTML exposes the canonical MeetHint social metadata set.
 *
 * Usage:
 *   node scripts/verify-production-social-meta.mjs
 *   node scripts/verify-production-social-meta.mjs --base https://www.meethint.ai
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMainModule } from "./with-app-env.mjs";

const DEFAULT_BASE = "https://www.meethint.ai";
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

/** @param {string} html @param {string} key @param {"property"|"name"} attr */
function metaContent(html, key, attr = "property") {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta\\s+${attr}=["']${escaped}["']\\s+content=["']([^"']*)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta\\s+content=["']([^"']*)["']\\s+${attr}=["']${escaped}["']`,
    "i",
  );
  return re.exec(html)?.[1] ?? alt.exec(html)?.[1] ?? "";
}

function linkHref(html, rel) {
  const re = new RegExp(`<link\\s+rel=["']${rel}["']\\s+href=["']([^"']*)["']`, "i");
  const alt = new RegExp(`<link\\s+href=["']([^"']*)["']\\s+rel=["']${rel}["']`, "i");
  return re.exec(html)?.[1] ?? alt.exec(html)?.[1] ?? "";
}

function titleText(html) {
  return html.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
}

async function loadExpected() {
  const brandUrl = pathToFileURL(
    join(dirname(fileURLToPath(import.meta.url)), "../src/lib/brand.ts"),
  ).href;
  const brand = await import(brandUrl);
  return {
    title: brand.MEETHINT_TITLE,
    description: brand.MEETHINT_DESCRIPTION,
    canonical: brand.MEETHINT_CANONICAL_URL,
    ogTitle: brand.MEETHINT_OG_TITLE,
    ogDescription: brand.MEETHINT_OG_DESCRIPTION,
    ogType: "website",
    ogUrl: brand.MEETHINT_CANONICAL_URL,
    ogSiteName: brand.MEETHINT_NAME,
    ogImage: brand.MEETHINT_OG_IMAGE,
    ogImageAlt: brand.MEETHINT_OG_IMAGE_ALT,
    twitterCard: "summary_large_image",
    twitterTitle: brand.MEETHINT_OG_TITLE,
    twitterDescription: brand.MEETHINT_TWITTER_DESCRIPTION,
    twitterImage: brand.MEETHINT_OG_IMAGE,
  };
}

/** @param {string} baseUrl @param {typeof fetch} fetchImpl */
export async function verifyProductionSocialMeta(baseUrl, fetchImpl = fetch) {
  const expected = await loadExpected();
  const report = {
    baseUrl,
    blockers: [],
    observed: {},
    expected,
  };

  let html;
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/`, {
      headers: { accept: "text/html", "user-agent": CRAWLER_UA },
      redirect: "follow",
    });
    if (!res.ok) {
      report.blockers.push(`homepage-http-${res.status}`);
      return report;
    }
    html = await res.text();
  } catch (error) {
    report.blockers.push(`homepage-unreachable:${error instanceof Error ? error.message : String(error)}`);
    return report;
  }

  report.observed = {
    title: titleText(html),
    description: metaContent(html, "description", "name"),
    canonical: linkHref(html, "canonical"),
    ogTitle: metaContent(html, "og:title"),
    ogDescription: metaContent(html, "og:description"),
    ogType: metaContent(html, "og:type"),
    ogUrl: metaContent(html, "og:url"),
    ogSiteName: metaContent(html, "og:site_name"),
    ogImage: metaContent(html, "og:image"),
    ogImageWidth: metaContent(html, "og:image:width"),
    ogImageHeight: metaContent(html, "og:image:height"),
    ogImageAlt: metaContent(html, "og:image:alt"),
    twitterCard: metaContent(html, "twitter:card", "name"),
    twitterTitle: metaContent(html, "twitter:title", "name"),
    twitterDescription: metaContent(html, "twitter:description", "name"),
    twitterImage: metaContent(html, "twitter:image", "name"),
  };

  for (const [key, value] of Object.entries(expected)) {
    if (report.observed[key] !== value) {
      report.blockers.push(`${key}: expected "${value}", got "${report.observed[key] ?? ""}"`);
    }
  }

  if (report.observed.ogImageWidth !== "1200") {
    report.blockers.push(`ogImageWidth: expected "1200", got "${report.observed.ogImageWidth}"`);
  }
  if (report.observed.ogImageHeight !== "630") {
    report.blockers.push(`ogImageHeight: expected "630", got "${report.observed.ogImageHeight}"`);
  }

  if (/Live meeting copilot/i.test(html)) {
    report.blockers.push("stale-copy: Live meeting copilot");
  }
  if (/\/og\.jpg/i.test(html)) {
    report.blockers.push("stale-asset: /og.jpg referenced in HTML");
  }
  if (/fb:app_id/i.test(html)) {
    report.blockers.push("unexpected-fb-app-id: do not emit fake fb:app_id");
  }

  try {
    const imageRes = await fetchImpl(expected.ogImage, { method: "HEAD", redirect: "follow" });
    if (!imageRes.ok) {
      report.blockers.push(`og-image-http-${imageRes.status}`);
    } else {
      const type = imageRes.headers.get("content-type") ?? "";
      if (!type.includes("image/png")) {
        report.blockers.push(`og-image-type:${type || "missing"}`);
      }
    }
  } catch (error) {
    report.blockers.push(`og-image-unreachable:${error instanceof Error ? error.message : String(error)}`);
  }

  return report;
}

function parseBase(argv) {
  const idx = argv.indexOf("--base");
  const base = idx >= 0 && argv[idx + 1] ? argv[idx + 1] : process.env.MEETHINT_DEPLOY_BASE_URL ?? DEFAULT_BASE;
  return base.replace(/\/+$/, "");
}

async function main(argv = process.argv.slice(2)) {
  const baseUrl = parseBase(argv);
  const report = await verifyProductionSocialMeta(baseUrl);
  if (report.blockers.length === 0) {
    console.log(`[verify-social-meta] OK — ${baseUrl} matches canonical metadata`);
    console.log(`  og:image ${report.expected.ogImage}`);
    console.log("  fb:app_id warning is expected (no Meta app integration).");
    return 0;
  }
  console.error(`[verify-social-meta] FAIL — ${baseUrl}`);
  for (const blocker of report.blockers) console.error(`  - ${blocker}`);
  return 1;
}

if (isMainModule(import.meta.url)) {
  main().then((code) => process.exit(code));
}

export default verifyProductionSocialMeta;
