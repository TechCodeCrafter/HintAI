import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { MEETHINT_DESCRIPTION, MEETHINT_DOMAIN, MEETHINT_NAME, MEETHINT_TITLE } from "../brand.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const FORBIDDEN_MARKETING = [
  /generating when it needs/i,
  /answers from knowledge/i,
  /citing sources when it can/i,
  /generate when the files/i,
  /general knowledge/i,
  /Nothing is generated/i,
];

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

test("brand constants are MeetHint everywhere public", () => {
  assert.equal(MEETHINT_NAME, "MeetHint");
  assert.equal(MEETHINT_DOMAIN, "meethint.ai");
  assert.match(MEETHINT_TITLE, /MeetHint/);
  assert.match(MEETHINT_DESCRIPTION, /cite/i);
  assert.doesNotMatch(MEETHINT_DESCRIPTION, /general knowledge/i);

  const pkg = JSON.parse(read("package.json")) as {
    name: string;
    homepage: string;
    description: string;
  };
  assert.equal(pkg.name, "meethint");
  assert.equal(pkg.homepage, "https://meethint.ai");
  assert.match(pkg.description, /MeetHint/);

  const site = JSON.parse(read("src/lib/og/site.json")) as { title: string; description?: string };
  assert.equal(site.title, "MeetHint");
  assert.ok(site.description);
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
  assert.doesNotMatch(landing, />\s*Hint\s*</);
  assert.match(landing, /Cite it, or stay silent/);

  const index = read("src/routes/index.tsx");
  assert.match(index, /MEETHINT_TITLE/);
  assert.match(index, /MEETHINT_DESCRIPTION/);
  assert.doesNotMatch(index, /Hint — live answers/);

  const appRoot = read("src/routes/__root.tsx");
  assert.match(appRoot, /MEETHINT_NAME/);
  assert.doesNotMatch(appRoot, /APP_NAME\s*=\s*"Hint"/);
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
  assert.match(route, /localCard third — never general knowledge/);
  assert.match(architecture, /localCard/);
});
