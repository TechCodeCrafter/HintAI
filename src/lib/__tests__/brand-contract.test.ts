import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  MEETHINT_CONTRACT,
  MEETHINT_DESCRIPTION,
  MEETHINT_DOMAIN,
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

test("brand module exports MeetHint cite-or-silence contract", () => {
  assert.equal(MEETHINT_NAME, "MeetHint");
  assert.equal(MEETHINT_DOMAIN, "meethint.ai");
  assert.match(MEETHINT_TITLE, /MeetHint/);
  assert.match(MEETHINT_DESCRIPTION, /cite/i);
  assert.doesNotMatch(MEETHINT_DESCRIPTION, /general knowledge/i);
  assert.match(MEETHINT_CONTRACT, /Cite or silence/i);
});

test("product UI files never promise a generate-from-knowledge path", () => {
  const files = [
    "src/components/meethint-landing.tsx",
    "src/routes/index.tsx",
    "src/routes/__root.tsx",
    "src/lib/og/site.json",
  ];
  for (const rel of files) {
    const text = readFileSync(join(root, rel), "utf8");
    for (const pattern of FORBIDDEN_MARKETING) {
      assert.doesNotMatch(text, pattern, `${rel} must not match ${pattern}`);
    }
  }
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
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const architecture = readFileSync(join(root, "ARCHITECTURE.md"), "utf8");
  assert.match(readme, /Cite or silence/i);
  assert.match(readme, /no general-knowledge/i);
  assert.match(architecture, /Cite or silence/i);
  assert.match(architecture, /no general-knowledge/i);
});
