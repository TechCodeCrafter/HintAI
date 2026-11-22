import assert from "node:assert/strict";
import { test } from "node:test";

import { quotesWholeSentences } from "../claim-verify.ts";
import { isConfigPath, locateInCode } from "../code-locator.ts";
import { parseSections } from "../doc-section.ts";
import { statesCause } from "../intent.ts";
import { localCard } from "../local-card.ts";
import { NORTHSTAR } from "../../repo/northstar.ts";
import { buildChunks, retrieve } from "../retrieve.ts";
import { contentWords } from "../spoken.ts";
import type { FileHit, RepoPack } from "../../repo/types.ts";

/** Code and configuration with little prose: the material these rules are for. */
const OPS = {
  id: "ops-pack",
  name: "ops-pack",
  description: "Code and config with little prose",
  commits: [],
  files: [
    {
      path: "src/search/considered.ts",
      language: "ts",
      content: [
        'import type { Hit } from "./types";',
        "",
        "/**",
        " * The other files retrieval ranked for this question, best first, that the",
        " * answer does not cite.",
        " */",
        "export function consideredSources(hits: Hit[], cited: Set<string>): Hit[] {",
        "  return hits.filter((source) => !cited.has(source.path)).slice(0, 3);",
        "}",
        "",
      ].join("\n"),
    },
    {
      path: "config/cache.yml",
      language: "yaml",
      content: [
        "# Redis cache settings for the API tier.",
        "cache:",
        "  driver: redis",
        "  # Entries expire after ten minutes so stale prices never outlive a deploy.",
        "  ttl_seconds: 600",
        "  max_entries: 50000",
        "  eviction: allkeys-lru",
        "sessions:",
        "  store: redis",
        "  ttl_seconds: 86400",
        "",
      ].join("\n"),
    },
    {
      path: "config/deploy.json",
      language: "json",
      content:
        JSON.stringify(
          {
            region: "us-east-1",
            replicas: 3,
            healthCheck: { path: "/healthz", intervalSeconds: 15 },
            rollout: { strategy: "canary", stepPercent: 10 },
          },
          null,
          2,
        ) + "\n",
    },
    {
      path: "config/model.yml",
      language: "yaml",
      content: [
        "model:",
        "  max_tokens: 4096",
        "  api_key: sk_live_4f9a1c2b7d",
        "  signing_secret: hunter2",
        "  session_token: 9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c",
        "",
      ].join("\n"),
    },
    {
      path: "README.md",
      language: "md",
      content: "# Ops pack\n\nA small service that accepts events and forwards them to customer endpoints.\n",
    },
  ],
} as unknown as RepoPack;

function ask(pack: RepoPack, question: string) {
  return localCard(question, retrieve(question, buildChunks(pack)), pack, 0);
}

const contentOf = (pack: RepoPack, path: string) => pack.files.find((file) => file.path === path)?.content;

function wholeFileHit(pack: RepoPack, path: string): FileHit {
  const content = contentOf(pack, path)!;
  return {
    id: `${path}#0`,
    kind: "code" as const,
    path,
    startOffset: 0,
    text: content,
    startLine: 1,
    endLine: content.split("\n").length,
    score: 10,
  } as unknown as FileHit;
}

function locate(question: string, path: string) {
  return locateInCode(question, contentWords(question.toLowerCase()), [wholeFileHit(OPS, path)], (p) =>
    contentOf(OPS, p),
  );
}

function fileCitation(card: ReturnType<typeof ask>) {
  const first = card.citations[0];
  assert.ok(first && first.kind === "file", "the answer cites a file");
  return first;
}

test("the retry question is answered from the top-ranked source file, not the decision record's header", () => {
  const card = ask(NORTHSTAR, "How does the app retry failed exports?");
  assert.equal(
    card.say,
    "Attempts are capped at three because the payment gateway stalls rather than failing fast, so a fourth attempt duplicates the settlement file instead of recovering it.",
  );
  const cite = fileCitation(card);
  assert.equal(cite.path, "src/exporter/retry.ts");
  assert.ok(contentOf(NORTHSTAR, cite.path)!.includes("Attempts are capped at three because"));
});

test("a record header is never spoken, wherever the answer comes from", () => {
  for (const question of ["How does the app retry failed exports?", "What is the retry policy?"]) {
    const card = ask(NORTHSTAR, question);
    assert.ok(card.say, `${question} is answered`);
    assert.doesNotMatch(card.say!, /\b(?:Date|Status|PR|Ticket):/, question);
  }
});

test("a block of field lines is not a paragraph, and ordinary prose still is", () => {
  const adr = contentOf(NORTHSTAR, "docs/adr/0007-exporter-retries.md")!;
  const units = parseSections(adr).flatMap((section) => section.units.map((unit) => unit.text));
  assert.ok(units.length > 0);
  assert.ok(!units.some((text) => /^Date:/m.test(text)), "the header block is dropped");
  assert.ok(units.some((text) => /capped at three/.test(text)), "the summary sentence is kept");

  const prose = parseSections("# Notes\n\nNote: this is a sentence.\nIt carries on here.\n");
  assert.ok(prose.some((section) => section.units.some((unit) => /this is a sentence/.test(unit.text))), "a sentence is not a field");
});

test("a setting that lives only in a JSON file is read out verbatim", () => {
  const card = ask(OPS, "What is the deploy region?");
  assert.equal(card.say, 'The current value is `"region": "us-east-1"`.');
  const cite = fileCitation(card);
  assert.equal(cite.path, "config/deploy.json");
  const line = contentOf(OPS, cite.path)!.split("\n")[cite.line - 1]!;
  assert.ok(line.includes('"region": "us-east-1"'), "the cited line carries the value");
});

test("a nested JSON key and a bare YAML value are both found by their key", () => {
  const nested = locate("What is the health check path?", "config/deploy.json");
  assert.ok(nested);
  assert.equal(nested.kind, "value");
  assert.match(nested.say, /"path": "\/healthz"/);

  const yaml = locate("How is cache eviction set up?", "config/cache.yml");
  assert.ok(yaml);
  assert.equal(yaml.kind, "value");
  assert.equal(yaml.inferred, true, "the question did not ask for a value");
  assert.match(yaml.say, /eviction: allkeys-lru/);
});

test("configuration files are recognised by path, and environment files are left out", () => {
  assert.equal(isConfigPath("config/cache.yml"), true);
  assert.equal(isConfigPath("vite.config.ts"), true);
  assert.equal(isConfigPath("src/search/considered.ts"), false);
  assert.equal(isConfigPath(".env"), false, "environment files are not read for settings");
  assert.equal(isConfigPath(".env.production"), false);
});

test("a setting does not displace a sentence someone wrote", () => {
  // "entries" names the max_entries key, so a setting is on offer for both.
  for (const question of ["How is the cache configured?", "How do cache entries expire?"]) {
    const card = ask(OPS, question);
    assert.equal(card.say, "Entries expire after ten minutes so stale prices never outlive a deploy.", question);
    assert.equal(fileCitation(card).path, "config/cache.yml");
  }
});

test("credentials are never read out, and an ordinary setting beside them still is", () => {
  for (const question of [
    "What is the model api key?",
    "What is the signing secret?",
    "What is the session token?",
  ]) {
    const located = locate(question, "config/model.yml");
    assert.ok(!located || !/sk_live|hunter2|9f8e7d6c/.test(located.say), question);
    const card = ask(OPS, question);
    assert.ok(!card.say || !/sk_live|hunter2|9f8e7d6c/.test(card.say), `${question} (card)`);
  }
  const tokens = locate("What is the max tokens setting?", "config/model.yml");
  assert.ok(tokens);
  assert.match(tokens.say, /max_tokens: 4096/);
});

test("a docstring quoted whole is spoken even though one of its clauses carries the negation", () => {
  const card = ask(OPS, "What is a considered source?");
  assert.equal(
    card.say,
    "The other files retrieval ranked for this question, best first, that the answer does not cite.",
  );
  assert.equal(fileCitation(card).path, "src/search/considered.ts");

  const corpus = "The other files retrieval ranked for this question, best first, that the answer does not cite.";
  assert.equal(quotesWholeSentences("The other files retrieval ranked for this question, best first.", corpus), false);
  assert.equal(quotesWholeSentences("The answer does cite.", corpus), false);
});

test("why is answered by the sentence that gives its cause", () => {
  const card = ask(NORTHSTAR, "Why is the column order locked?");
  assert.ok(card.say);
  assert.match(card.say!, /which is why the order is locked/);
  assert.equal(fileCitation(card).path, "src/exporter/format.ts");
});

test("a rationale word alone does not pick a sentence, and a consequence is not a reason", () => {
  assert.equal(statesCause("Narrowed because the pane can only paint file lines."), true);
  assert.equal(statesCause("Writes one line per settlement, which is why the order is locked."), true);
  assert.equal(statesCause("The claim was chosen and then lost on the way to being spoken."), false);
  assert.equal(statesCause("Entries expire after ten minutes so stale prices never outlive a deploy."), false);

  const card = ask(OPS, "Why do cache entries expire?");
  assert.equal(card.say, null);
});
