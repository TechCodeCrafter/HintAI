import assert from "node:assert/strict";
import { test } from "node:test";

import { quotesWholeSentences, verifyClaimSemantics } from "../claim-verify.ts";
import { covers, locateInCode } from "../code-locator.ts";
import { parseSections, sectionAnswer } from "../doc-section.ts";
import { localCard } from "../local-card.ts";
import { contentWords } from "../spoken.ts";
import type { FileHit, RepoPack } from "../../repo/types.ts";

const README = `# Demo

[![CI](https://example.com/badge.svg)](https://example.com/ci)

Answer questions about your codebase live. No login, no database, no history: everything lives in the current browser tab.

* [Installation](#installation)
* [License](#license)

## Your key

- **Locked connections:** only the AI providers are allowed. GitHub connections are blocked; the app doesn't connect to GitHub at all.
- **Dedupe:** Re-asked questions within 90 seconds are merged, not answered twice.

## Self-host

Run it locally:

\`\`\`bash
git clone https://github.com/acme/demo
cd demo
npm install
npm run dev        # http://localhost:3000
\`\`\`

Optional server keys let your team use AI without anyone pasting a key. They're read only on the server and never sent to the browser:

\`\`\`bash
OPENAI_API_KEY=...
GROQ_API_KEY=...
\`\`\`

## Installation

Installation is done using the [\`npm install\` command](https://docs.npmjs.com/):

\`\`\`sh
$ npm install demo
\`\`\`

## Configuration Options

* \`maxAge\`: Configures the **Access-Control-Max-Age** header. Set to an integer.
* \`origin\`: Configures the **Access-Control-Allow-Origin** header.

## Related Packages

- [demo.macro](https://example.com) - Run demo as a package macro at build-time.

## Tests

\`\`\`bash
npm test
\`\`\`

## Original Author

[Ada Lovelace](https://example.com/ada)

## License

MIT.
`;

const PROVIDERS = `export const PROVIDERS = {
  openai: { label: "OpenAI", env: "OPENAI_API_KEY", model: "gpt-5-mini" },
  groq: { label: "Groq", env: "GROQ_API_KEY", model: "llama-3.3-70b" },
} as const;
`;

const DEFAULTS = `var defaults = {
  origin: '*',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  optionsSuccessStatus: 204
};
`;

function hitOf(path: string, content: string): FileHit {
  return {
    id: `${path}#0`,
    kind: "code",
    path,
    startOffset: 0,
    text: content,
    startLine: 1,
    endLine: content.split("\n").length,
    score: 10,
  } as unknown as FileHit;
}

function answer(question: string, opts?: { requireAll?: boolean }) {
  return sectionAnswer(question, contentWords(question), [hitOf("README.md", README)], () => README, opts);
}

test("parseSections drops badges, link-only TOC entries and shell prompts", () => {
  const sections = parseSections(README);
  const texts = sections.flatMap((section) => section.units.map((unit) => unit.text));
  assert.ok(!texts.some((text) => /badge|\bCI\b/.test(text)), "badge line is not prose");
  assert.ok(!texts.includes("Installation"), "TOC link is not a fact");
  assert.ok(texts.includes("npm install demo"), "the $ prompt is stripped");
  assert.ok(texts.includes("npm run dev"), "the trailing # comment is stripped");
});

test("a how-to answers with the commands under the matching heading", () => {
  const selfHost = answer("How do I self-host it?");
  assert.equal(selfHost?.say, "Run it locally: git clone https://github.com/acme/demo, cd demo, npm install and npm run dev.");
  assert.equal(answer("How do I run the tests?")?.say, "Run npm test.");
  assert.match(answer("How do I install it?")?.say ?? "", /npm install demo\.$/);
});

test("a pronoun lead-in brings the sentence that names it, and env blocks read as variables", () => {
  const env = answer("Which environment variables are needed for server keys?");
  assert.equal(
    env?.say,
    "Optional server keys let your team use AI without anyone pasting a key. They're read only on the server and never sent to the browser: OPENAI_API_KEY and GROQ_API_KEY.",
  );
});

test("short answers take the heading as their subject", () => {
  assert.equal(answer("What license is it under?")?.say, "License: MIT.");
  assert.equal(answer("Who is the original author?")?.say, "Original Author: Ada Lovelace.");
});

test("bullet labels name their topic, and asides never answer", () => {
  assert.match(answer("What does maxAge configure?")?.say ?? "", /^maxAge: Configures the Access-Control-Max-Age header\./);
  // "Related Packages" mentions "package" but describes another project.
  assert.doesNotMatch(answer("What does this package do?")?.say ?? "", /macro/);
});

test("yes/no questions need a line that names every part", () => {
  assert.equal(
    answer("Is there a database?", { requireAll: true })?.say,
    "No login, no database, no history: everything lives in the current browser tab.",
  );
  assert.match(answer("Does it connect to GitHub?", { requireAll: true })?.say ?? "", /GitHub/);
  assert.equal(answer("Is there a Kubernetes cluster?", { requireAll: true }), null);
});

test("off-topic questions get nothing from the README", () => {
  for (const question of ["What is the parental leave policy?", "What is the Q3 revenue target?", "How do we handle PCI compliance?"]) {
    assert.equal(answer(question), null, question);
  }
});

test("whole quoted sentences keep their negation without tripping the paraphrase check", () => {
  const corpus = "- **Locked:** GitHub connections are blocked; the app doesn't connect to GitHub at all.";
  const say = "GitHub connections are blocked; the app doesn't connect to GitHub at all.";
  assert.equal(quotesWholeSentences(say, corpus), true);
  assert.equal(quotesWholeSentences("the app connect to GitHub at all.", corpus), false, "a fragment is not a quote");
  // Dropping the negation is still caught.
  assert.equal(
    verifyClaimSemantics("The app connects to GitHub.", corpus.toLowerCase(), ["connects", "github"]).ok,
    false,
  );
});

test("prefix matches need a suffix, not a different word", () => {
  assert.equal(covers("Installation", ["install"]), 1);
  assert.equal(covers("authorization", ["author"]), 0);
});

test("the locator lists a collection and reads one field of an entry", () => {
  const files = (path: string) => (path === "lib/providers.ts" ? PROVIDERS : DEFAULTS);
  const hit = hitOf("lib/providers.ts", PROVIDERS);
  const list = locateInCode("Which AI providers are supported?", contentWords("Which AI providers are supported?"), [hit], files);
  assert.equal(list?.kind, "list");
  assert.equal(list?.say, "`PROVIDERS` lists OpenAI and Groq.");
  const q = "What model does the OpenAI provider use?";
  const field = locateInCode(q, contentWords(q), [hit], files);
  assert.equal(field?.say, "The `openai` model is `gpt-5-mini`.");
  const d = "What methods are allowed by default?";
  const value = locateInCode(d, contentWords(d), [hitOf("lib/index.js", DEFAULTS)], files);
  assert.equal(value?.say, "The current value is `methods: 'GET,HEAD,PUT,PATCH,POST,DELETE'`.");
});

test("localCard speaks README answers and stays silent off-topic", () => {
  const pack = {
    id: "demo",
    name: "demo",
    description: "",
    commits: [],
    files: [
      { path: "README.md", language: "md", content: README },
      { path: "lib/providers.ts", language: "ts", content: PROVIDERS },
    ],
  } as unknown as RepoPack;
  const hits = [hitOf("README.md", README), hitOf("lib/providers.ts", PROVIDERS)];
  const card = (q: string) => localCard(q, hits, pack, 0);
  assert.equal(card("Does it connect to GitHub?").say?.includes("GitHub"), true);
  assert.equal(card("Is there a database?").say, "No login, no database, no history: everything lives in the current browser tab.");
  assert.equal(card("Which AI providers are supported?").say, "`PROVIDERS` lists OpenAI and Groq.");
  assert.equal(card("What is the parental leave policy?").say ?? null, null);
  // "policy" alone must not pull in a line about some other policy.
  const policyPack = { ...pack, files: [...pack.files, { path: "docs/retry.md", language: "md", content: "# Retries\n\nThis is not a generic HTTP retry policy; it exists because the gateway stalls.\n" }] } as unknown as RepoPack;
  const policyHits = [hitOf("docs/retry.md", policyPack.files[2]!.content), ...hits];
  assert.equal(localCard("What is the vacation policy?", policyHits, policyPack, 0).say ?? null, null);
  const selfHost = card("How do I self-host it?");
  assert.match(selfHost.say ?? "", /^Run it locally: git clone/);
  const first = selfHost.citations?.[0];
  assert.equal(first && first.kind === "file" ? first.path : null, "README.md");
});
