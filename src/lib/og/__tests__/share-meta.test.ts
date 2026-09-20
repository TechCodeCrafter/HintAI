import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MEETHINT_CANONICAL_URL,
  MEETHINT_DESCRIPTION,
  MEETHINT_NAME,
  MEETHINT_OG_DESCRIPTION,
  MEETHINT_OG_IMAGE,
  MEETHINT_OG_IMAGE_ALT,
  MEETHINT_OG_TITLE,
  MEETHINT_TITLE,
  MEETHINT_TWITTER_DESCRIPTION,
} from "../../brand.ts";
import { shareOgHeadMeta } from "../share-meta.ts";

function metaMap() {
  const map = new Map<string, string>();
  for (const entry of shareOgHeadMeta()) {
    if ("property" in entry) map.set(entry.property, entry.content);
    if ("name" in entry) map.set(entry.name, entry.content);
  }
  return map;
}

test("shareOgHeadMeta emits the canonical marketing metadata set", () => {
  const meta = metaMap();
  assert.equal(meta.get("og:title"), MEETHINT_OG_TITLE);
  assert.equal(meta.get("og:description"), MEETHINT_OG_DESCRIPTION);
  assert.equal(meta.get("og:type"), "website");
  assert.equal(meta.get("og:url"), MEETHINT_CANONICAL_URL);
  assert.equal(meta.get("og:site_name"), MEETHINT_NAME);
  assert.equal(meta.get("og:image"), MEETHINT_OG_IMAGE);
  assert.equal(meta.get("og:image:width"), "1200");
  assert.equal(meta.get("og:image:height"), "630");
  assert.equal(meta.get("og:image:alt"), MEETHINT_OG_IMAGE_ALT);
  assert.equal(meta.get("twitter:card"), "summary_large_image");
  assert.equal(meta.get("twitter:title"), MEETHINT_OG_TITLE);
  assert.equal(meta.get("twitter:description"), MEETHINT_TWITTER_DESCRIPTION);
  assert.equal(meta.get("twitter:image"), MEETHINT_OG_IMAGE);
  assert.match(MEETHINT_OG_IMAGE, /meethint-og-v2\.png$/);
  assert.doesNotMatch(MEETHINT_OG_IMAGE, /\/og\.jpg$/);
  assert.doesNotMatch(MEETHINT_TITLE, /Live meeting copilot/i);
  assert.doesNotMatch(MEETHINT_DESCRIPTION, /Live meeting copilot/i);
});
