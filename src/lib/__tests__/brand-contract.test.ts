import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  MEETHINT_CONTRACT,
  MEETHINT_DESCRIPTION,
  MEETHINT_DOMAIN,
  MEETHINT_MARK,
  MEETHINT_NAME,
  MEETHINT_TITLE,
} from "../brand.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Canonical product strings — design skills must not embed or instruct rewriting these. */
export const CANONICAL_BRAND_STRINGS = [
  MEETHINT_NAME,
  MEETHINT_DOMAIN,
  MEETHINT_TITLE,
  MEETHINT_DESCRIPTION,
  MEETHINT_CONTRACT,
  "Cite it, or stay silent.",
  "No general-knowledge fallback.",
] as const;

const FORBIDDEN_MARKETING = [
  /generating when it needs/i,
  /answers from knowledge/i,
  /citing sources when it can/i,
  /generate when the files/i,
  /general knowledge/i,
  /Nothing is generated/i,
];

const SKILL_ROOTS = [".cursor/skills", ".agents/skills"];

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function listSkillMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...listSkillMarkdownFiles(path));
    else if (entry.endsWith(".md")) out.push(path);
  }
  return out;
}

test("brand constants are MeetHint everywhere public", () => {
  assert.equal(MEETHINT_NAME, "MeetHint");
  assert.equal(MEETHINT_MARK, "Hint");
  assert.equal(MEETHINT_DOMAIN, "meethint.ai");
  assert.match(MEETHINT_TITLE, /MeetHint/);
  assert.match(MEETHINT_DESCRIPTION, /cite/i);
  assert.doesNotMatch(MEETHINT_DESCRIPTION, /general knowledge/i);
  assert.match(MEETHINT_CONTRACT, /Cite or silence/i);

  const pkg = JSON.parse(read("package.json")) as {
    name: string;
    homepage: string;
    description: string;
  };
  assert.equal(pkg.name, "meethint");
  assert.equal(pkg.homepage, "https://meethint.ai");
  assert.match(pkg.description, /MeetHint/);

  const site = JSON.parse(read("src/lib/og/site.json")) as {
    title: string;
    description?: string;
    image?: string;
  };
  assert.match(site.title, /MeetHint/);
  assert.ok(site.description);
  assert.equal(site.image, "/og/meethint-og-v2.png");
  assert.doesNotMatch(site.description!, /general knowledge/i);
});

test("landing, routes, and OG never promise a generate-from-knowledge path", () => {
  const files = [
    "src/components/meethint-landing.tsx",
    "src/routes/index.tsx",
    "src/routes/__root.tsx",
    "src/lib/og/site.json",
  ];
  for (const rel of files) {
    const text = read(rel);
    for (const pattern of FORBIDDEN_MARKETING) {
      assert.doesNotMatch(text, pattern, `${rel} must not match ${pattern}`);
    }
  }

  const landing = read("src/components/meethint-landing.tsx");
  assert.match(landing, /MEETHINT_NAME/);
  assert.match(landing, /MEETHINT_MARK/);
  assert.doesNotMatch(landing, />\s*Hint\s*</);
  assert.match(landing, /Cite it, or stay silent/);

  const appRoot = read("src/routes/__root.tsx");
  assert.match(appRoot, /MEETHINT_NAME/);
  assert.match(appRoot, /MEETHINT_TITLE/);
  assert.match(appRoot, /MEETHINT_DESCRIPTION/);
  assert.match(appRoot, /shareOgHeadMeta/);
  assert.doesNotMatch(appRoot, /APP_NAME\s*=\s*"Hint"/);
  assert.doesNotMatch(appRoot, /og\.jpg/);

  const shareMeta = read("src/lib/og/share-meta.ts");
  const brandModule = read("src/lib/brand.ts");
  assert.match(shareMeta, /og:type/);
  assert.match(shareMeta, /og:url/);
  assert.match(shareMeta, /MEETHINT_OG_IMAGE/);
  assert.match(brandModule, /meethint-og-v2\.png/);
  assert.doesNotMatch(brandModule, /\/og\.jpg/);
});

test("design skill files must not reference or rewrite brand module copy", () => {
  const brandPath = "src/lib/brand.ts";
  const protectedSnippets = CANONICAL_BRAND_STRINGS.filter((s) => s.length >= 24);

  for (const skillRoot of SKILL_ROOTS) {
    const absRoot = join(root, skillRoot);
    for (const file of listSkillMarkdownFiles(absRoot)) {
      const rel = file.slice(root.length + 1);
      if (rel.includes("design-qa-playwright")) continue;
      const text = readFileSync(file, "utf8");

      assert.doesNotMatch(
        text,
        /src\/lib\/brand\.ts|@\/lib\/brand/,
        `${rel} must not instruct edits to the brand module`,
      );
      assert.doesNotMatch(
        text,
        /MEETHINT_(NAME|TITLE|DESCRIPTION|CONTRACT|DOMAIN)/,
        `${rel} must not reference brand module export keys`,
      );

      for (const snippet of protectedSnippets) {
        assert.equal(
          text.includes(snippet),
          false,
          `${rel} must not embed canonical product copy: ${snippet.slice(0, 40)}…`,
        );
      }

      for (const pattern of FORBIDDEN_MARKETING) {
        assert.doesNotMatch(
          text,
          pattern,
          `${rel} must not promote forbidden marketing: ${pattern}`,
        );
      }
    }
  }

  assert.ok(
    statSync(join(root, brandPath)).isFile(),
    `${brandPath} is the single source for public product strings`,
  );
});

test("README and ARCHITECTURE agree on cite-or-silence", () => {
  const readme = read("README.md");
  const architecture = read("ARCHITECTURE.md");
  const contract = /Cite or silence/i;
  const noGeneral = /no general-knowledge/i;

  assert.match(readme, contract);
  assert.match(readme, noGeneral);
  assert.match(architecture, contract);
  assert.match(architecture, noGeneral);
  assert.match(architecture, /Generated from the repository/);

  const route = read("src/lib/search/answer-route.ts");
  assert.match(route, /localCard fallback — never general knowledge/);
  assert.match(route, /localCardFastPathEligible/);
  assert.match(architecture, /localCard/);
});
