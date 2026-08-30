/**
 * The citation contract.
 *
 * A Card makes two promises: these words are in your material, and here is
 * where. Both were once enforced somewhere other than the code that speaks —
 * the line came from the retrieved chunk, which is a 28-line window, and support
 * was checked offline by a script on five hand-picked questions. These tests
 * hold the runtime to both, for each kind of evidence, against its own source.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { NORTHSTAR } from "../repo/northstar.ts";
import type { Card, Citation, FileCitation, RepoPack } from "../repo/types.ts";
import { citationText } from "./cite.ts";
import {
  type Evidence,
  type TextEvidence,
  GLUE,
  commitEvidence,
  commitIsCurrent,
  establishesAuthorship,
  evidenceIsCurrent,
  hashText,
  lineAt,
  textIsCurrent,
  verifyClaim,
} from "./evidence.ts";
import { localCard, questionChips } from "./local-card.ts";
import { buildChunks, retrieve } from "./retrieve.ts";

function packOf(
  files: Array<{ path: string; content: string }>,
  commits: RepoPack["commits"] = [],
): RepoPack {
  return {
    id: "evidence-fixture",
    name: "evidence-fixture",
    description: "fixture",
    files: files.map((f) => ({ ...f, language: f.path.split(".").pop() ?? "txt" })),
    commits,
  };
}

function ask(pack: RepoPack, query: string, chunks = buildChunks(pack)) {
  const hits = retrieve(query, chunks);
  return { hits, card: localCard(query, hits, pack, 0, null) };
}

/** The first citation, asserted to be file-backed so its coordinates can be read. */
function fileCite(card: Card, at = 0): FileCitation {
  const cite = card.citations[at];
  assert.ok(cite, `expected a citation at ${at}`);
  assert.equal(cite.kind, "file", `expected a file citation, got ${cite.kind}`);
  return cite as FileCitation;
}

/** The first piece of evidence, asserted to be text so its offsets can be read. */
function textEv(card: Card, at = 0): TextEvidence {
  const item = (card.evidence ?? [])[at];
  assert.ok(item, `expected evidence at ${at}`);
  assert.equal(item.kind, "text", `expected text evidence, got ${item.kind}`);
  return item as TextEvidence;
}

/** Sources as the evidence model asks about them. */
function sourcesOf(pack: RepoPack) {
  return {
    file: (path: string) => pack.files.find((f) => f.path === path)?.content,
    commit: (sha: string) => pack.commits.find((c) => c.sha === sha),
    document: (_sourceId: string) => undefined,
  };
}

/** The 1-based line a piece of text starts on, computed independently. */
function lineOf(content: string, needle: string): number {
  const at = content.indexOf(needle);
  assert.notEqual(at, -1, `fixture should contain: ${needle.slice(0, 40)}`);
  return content.slice(0, at).split("\n").length;
}

// A module whose docstring is not the first thing in the file — the ordinary
// case once there is a shebang, a licence header, or an import above it.
const HEADED = `#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Ingest worker.

This worker extracts biocompatibility tables from uploaded laboratory PDFs.
"""

def run():
    return None
`;

// A descriptive docstring far enough down the file that no chunk begins on it.
const DEEP = [
  ...Array.from({ length: 48 }, (_, i) => `LINE_${i + 1} = ${i + 1}`),
  '"""',
  "The settlement exporter writes reconciled payout rows to the warehouse.",
  '"""',
].join("\n");

/**
 * The same file, but with a short docstring at the top so the file-head pass
 * finds nothing sayable. That leaves the deep docstring reachable only through
 * the retrieved chunk, which is what makes the staleness case observable: with
 * a head claim available the composer would simply re-read the current file and
 * the stale index would never be consulted.
 */
function spanOnly(header = ""): string {
  return [
    header,
    '"""',
    "Config.",
    '"""',
    ...Array.from({ length: 45 }, (_, i) => `LINE_${i + 1} = ${i + 1}`),
    '"""',
    "The settlement exporter writes reconciled payout rows to the warehouse.",
    '"""',
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------- text evidence

test("text evidence's recorded range holds exactly the text it claims", () => {
  const pack = packOf([{ path: "workers/ingest.py", content: HEADED }]);
  const { card } = ask(pack, "What does the ingest worker do?");
  assert.ok(card.say, "the fixture states its purpose, so it should answer");
  assert.ok(card.evidence?.length, "a speaking Card must carry evidence");

  const span = textEv(card);
  const file = pack.files.find((f) => f.path === span.path);
  assert.ok(file, `evidence must point at loaded material: ${span.path}`);
  assert.equal(
    file.content.slice(span.startOffset, span.endOffset),
    span.text,
    "the recorded offsets must still hold the recorded text",
  );
  assert.equal(span.startLine, lineAt(file.content, span.startOffset));
  assert.equal(span.endLine, lineAt(file.content, span.endOffset - 1));
});

test("a file-head claim cites where the docstring is, not line 1", () => {
  const pack = packOf([{ path: "workers/ingest.py", content: HEADED }]);
  const { card } = ask(pack, "What does the ingest worker do?");
  const actual = lineOf(HEADED, "This worker extracts biocompatibility tables");

  assert.equal(actual, 6, "fixture sanity: the sentence is on line 6");
  assert.equal(fileCite(card).line, actual, "the citation must point at the sentence");
  assert.notEqual(fileCite(card).line, 1, "line 1 is the old approximation");
});

test("the retrieved chunk's first line does not become the citation", () => {
  const pack = packOf([{ path: "exporter/settlement.py", content: DEEP }]);
  const { hits, card } = ask(pack, "What does the settlement exporter do?");
  const actual = lineOf(DEEP, "The settlement exporter writes reconciled");

  assert.equal(actual, 50, "fixture sanity: the docstring sits on line 50");
  assert.ok(card.say, "the fixture states its purpose, so it should answer");
  assert.equal(fileCite(card).line, actual);

  // The window the evidence was retrieved in starts somewhere else entirely,
  // which is precisely what used to be quoted.
  const window = hits.find((h) => h.path === "exporter/settlement.py");
  assert.ok(window && (window.kind === "code" || window.kind === "why"), "retrieval should have ranked the file");
  assert.notEqual(window.startLine, actual, "fixture sanity: chunk boundary differs");
  assert.notEqual(fileCite(card).line, window.startLine);
});

test("a file citation renders its exact line range and nothing else", () => {
  const pack = packOf([{ path: "workers/ingest.py", content: HEADED }]);
  const { card } = ask(pack, "What does the ingest worker do?");
  const cite = fileCite(card);
  const span = textEv(card);

  assert.equal(cite.line, span.startLine);
  assert.equal(cite.endLine, span.endLine);
  const rendered = citationText(cite);
  assert.match(rendered, /^workers\/ingest\.py:\d+(-\d+)?$/, rendered);
  assert.match(rendered, new RegExp(`:${span.startLine}\\b`));
});

test("citations carry the evidence they were generated from", () => {
  const pack = packOf([{ path: "workers/ingest.py", content: HEADED }]);
  const { card } = ask(pack, "What does the ingest worker do?");
  const ids = new Set((card.evidence ?? []).map((item) => item.id));
  assert.ok(fileCite(card).evidenceId, "a citation should name its evidence");
  assert.ok(ids.has(fileCite(card).evidenceId as string));
});

// -------------------------------------------------------------- commit evidence

const COMMITS: RepoPack["commits"] = [
  {
    sha: "c4d88aa91f0",
    date: "2026-01-09",
    author: "Jordan Lee",
    message: "auth: rotate session cookies through edge middleware",
    files: ["src/auth/flow.ts"],
    pr: "640",
  },
];

const AUTH = `export async function runAuthFlow(request: Request) {
  return { ok: true };
}
`;

test("commit evidence never produces a file line number", () => {
  const pack = packOf([{ path: "src/auth/flow.ts", content: AUTH }], COMMITS);
  const { card } = ask(pack, "Who touched the auth flow?");
  assert.ok(card.say, "authorship is recorded, so this is answerable");

  const evidence = (card.evidence ?? [])[0];
  assert.ok(evidence);
  assert.equal(evidence.kind, "commit");
  // There is no line to read off it, at the model level or the citation level.
  assert.equal("startLine" in evidence, false, "commit evidence must carry no line");
  assert.equal("path" in evidence, false, "commit evidence must carry no path");

  const cite = card.citations[0];
  assert.equal(cite.kind, "commit");
  assert.equal("line" in cite, false, "a commit citation must carry no line");
  assert.equal(citationText(cite), "Commit c4d88aa · PR #640");
  assert.doesNotMatch(citationText(cite), /:\d+/, "no coordinate may be rendered");
  assert.doesNotMatch(citationText(cite), /\.ts/, "no file may be implied");
});

test("commit evidence keeps the provenance needed to verify and display it", () => {
  const evidence = commitEvidence(COMMITS[0], "spoken");
  assert.equal(evidence.sha, "c4d88aa91f0");
  assert.equal(evidence.shortSha, "c4d88aa");
  assert.equal(evidence.author, "Jordan Lee");
  assert.equal(evidence.date, "2026-01-09");
  assert.equal(evidence.pr, "640");
  assert.equal(evidence.message, COMMITS[0].message);
  assert.equal(evidence.contentHash, hashText(COMMITS[0].message));
});

test("commit message words are verified against the commit message", () => {
  const evidence = commitEvidence(COMMITS[0], "spoken");

  // Present in the message.
  assert.equal(verifyClaim("rotate session cookies", [evidence]).ok, true);
  // The recorded provenance fields are quotable too, and only those.
  assert.equal(verifyClaim("Jordan Lee rotate session cookies", [evidence]).ok, true);
  // Inflection is not paraphrase tolerance: the message says "rotate".
  assert.equal(verifyClaim("Jordan Lee rotated cookies", [evidence]).ok, false);
  // Absent from the message: the failure this gate exists for.
  const invented = verifyClaim("rotate session cookies through Redis", [evidence]);
  assert.equal(invented.ok, false);
  assert.ok(invented.missing.includes("redis"), `should flag it: ${invented.missing}`);
  // A different person is not in the evidence either.
  assert.equal(verifyClaim("Priya Shah rotated cookies", [evidence]).ok, false);
});

test("commit evidence whose message has changed cannot speak", () => {
  const pack = packOf([{ path: "src/auth/flow.ts", content: AUTH }], COMMITS);
  const { card } = ask(pack, "Who touched the auth flow?");
  const evidence = (card.evidence ?? [])[0];
  assert.ok(evidence && evidence.kind === "commit");

  assert.equal(evidenceIsCurrent(evidence, sourcesOf(pack)), true);

  // Amended, so the sha resolves but the message no longer says what was quoted.
  const amended = packOf(
    [{ path: "src/auth/flow.ts", content: AUTH }],
    [{ ...COMMITS[0], message: "auth: drop cookie rotation entirely" }],
  );
  assert.equal(evidenceIsCurrent(evidence, sourcesOf(amended)), false);
  assert.equal(commitIsCurrent(evidence, { message: "something else" }), false);

  // Rebased away, so history no longer contains it at all.
  const gone = packOf([{ path: "src/auth/flow.ts", content: AUTH }], []);
  assert.equal(evidenceIsCurrent(evidence, sourcesOf(gone)), false);
  assert.equal(commitIsCurrent(evidence, undefined), false);
});

test("a Card cannot speak from a commit the loaded history no longer records", () => {
  const query = "Who touched the auth flow?";
  const before = packOf([{ path: "src/auth/flow.ts", content: AUTH }], COMMITS);
  // The index is built once and cached by the store, so it still holds the
  // commit as it read it. History is then rewritten underneath it.
  const staleIndex = buildChunks(before);

  assert.ok(ask(before, query, staleIndex).card.say, "against its own history it must answer");

  const amended = packOf(
    [{ path: "src/auth/flow.ts", content: AUTH }],
    [{ ...COMMITS[0], message: "auth: drop cookie rotation entirely" }],
  );
  const { card } = ask(amended, query, staleIndex);
  assert.equal(card.say, null, "a sentence quoted from a rewritten commit must not be spoken");
  // The chip still shows where it looked, and still without a line.
  assert.equal(card.citations[0]?.kind, "commit");
  assert.doesNotMatch(citationText(card.citations[0]), /:\d+/);
});

// -------------------------------------------------------------------- who shape

test("a who question is answered from actual authorship evidence", () => {
  const pack = packOf([{ path: "src/auth/flow.ts", content: AUTH }], COMMITS);
  const { card } = ask(pack, "Who touched the auth flow?");

  assert.ok(card.say, "the commit records an author, so this is answerable");
  assert.match(card.say, /Jordan Lee/, `should name the author: ${card.say}`);
  assert.equal(card.citations[0].kind, "commit");
  assert.ok(establishesAuthorship((card.evidence ?? [])[0]));
  // Still held to the ordinary support check, with no structural allowance.
  assert.equal(verifyClaim(card.say, card.evidence ?? []).ok, true);
});

test("a who question stays silent when only unrelated prose is available", () => {
  // Same question, same file, but history carries no author for it.
  const anonymous = packOf([{ path: "workers/ingest.py", content: HEADED }]);
  const { card } = ask(anonymous, "Who touched the ingest worker?");
  assert.equal(card.say, null, `prose must not answer authorship: ${card.say}`);
  assert.match(card.reason ?? "", /who owns it/i);

  // And a commit with no author recorded is not authorship either.
  const unattributed = packOf(
    [{ path: "src/auth/flow.ts", content: AUTH }],
    [{ ...COMMITS[0], author: "" }],
  );
  assert.equal(ask(unattributed, "Who touched the auth flow?").card.say, null);
});

// ------------------------------------------------------------- support and drift

test("every word spoken is present in the evidence cited", () => {
  const packs = [
    packOf([{ path: "workers/ingest.py", content: HEADED }]),
    packOf([{ path: "exporter/settlement.py", content: DEEP }]),
    packOf([{ path: "src/auth/flow.ts", content: AUTH }], COMMITS),
  ];
  const queries = [
    "What does the ingest worker do?",
    "What does the settlement exporter do?",
    "How does the exporter write payout rows?",
    "Who touched the auth flow?",
    "What is this?",
  ];
  for (const pack of packs) {
    for (const query of queries) {
      const { card } = ask(pack, query);
      if (!card.say) continue;
      const support = verifyClaim(card.say, card.evidence ?? []);
      assert.ok(
        support.ok,
        `spoke words absent from its own evidence: ${support.missing.join(", ")} — "${card.say}"`,
      );
    }
  }
});

test("unsupported text cannot speak", () => {
  const pack = packOf([{ path: "workers/ingest.py", content: HEADED }]);
  const { card } = ask(pack, "What does the ingest worker do?");
  const span = textEv(card);

  // The shape of the failure the gate exists to stop: a fluent, plausible,
  // correctly-cited sentence containing a fact the file never states.
  const invented = "This worker retries failed uploads against the Kafka topic before giving up.";
  const check = verifyClaim(invented, [span]);
  assert.equal(check.ok, false);
  assert.ok(check.missing.includes("kafka"), `should flag the invented term: ${check.missing}`);

  // And the honest sentence still passes, so the gate is not simply refusing.
  assert.equal(verifyClaim(span.normalizedText, [span]).ok, true);
});

test("evidence extracted from material that has since changed cannot speak", () => {
  const query = "What does the settlement exporter do?";
  const before = packOf([{ path: "exporter/settlement.py", content: spanOnly() }]);
  // The index is built once and cached by the store; the material behind it is
  // then replaced, which shifts every offset the cached chunks were cut at.
  const staleIndex = buildChunks(before);

  const fresh = ask(before, query, staleIndex);
  assert.ok(fresh.card.say, "against its own material the fixture must answer");
  assert.equal(fileCite(fresh.card).line, 50);

  const after = packOf([{ path: "exporter/settlement.py", content: spanOnly("# an added header line") }]);
  const { card } = ask(after, query, staleIndex);
  assert.equal(card.say, null, "a sentence located against the old file must not be spoken");
  assert.match(card.reason ?? "", /back every word/i);
});

test("text evidence knows when its source has moved on", () => {
  const pack = packOf([{ path: "workers/ingest.py", content: HEADED }]);
  const { card } = ask(pack, "What does the ingest worker do?");
  const span = textEv(card);

  assert.equal(textIsCurrent(span, HEADED), true);
  assert.equal(textIsCurrent(span, undefined), false, "a missing file is not current");
  assert.equal(
    textIsCurrent(span, `# one more line\n${HEADED}`),
    false,
    "an edit above the span shifts it and must invalidate",
  );
  assert.equal(
    textIsCurrent(span, HEADED.replace("laboratory PDFs", "clinical PDFs")),
    false,
    "an edit inside the span must invalidate",
  );
  assert.equal(
    textIsCurrent(span, `${HEADED}\n# a trailing comment`),
    false,
    "the hash covers the whole document, not just the quoted range",
  );
});

test("each kind of evidence is checked against its own source", () => {
  const pack = packOf([{ path: "src/auth/flow.ts", content: AUTH }], COMMITS);
  const text = textEvidenceFixture();
  const commit = commitEvidence(COMMITS[0], "spoken");

  // A commit is not invalidated by an unrelated file edit, and text evidence is
  // not validated by history happening to still hold its commit.
  const edited = packOf([{ path: "src/auth/flow.ts", content: `${AUTH}\n// touched` }], COMMITS);
  assert.equal(evidenceIsCurrent(commit, sourcesOf(edited)), true);
  assert.equal(evidenceIsCurrent(text, sourcesOf(pack)), false, "that file is not in this pack");
});

function textEvidenceFixture(): Evidence {
  const pack = packOf([{ path: "workers/ingest.py", content: HEADED }]);
  const { card } = ask(pack, "What does the ingest worker do?");
  return textEv(card);
}

test("the content hash separates versions and survives identical content", () => {
  assert.equal(hashText(HEADED), hashText(HEADED));
  assert.notEqual(hashText(HEADED), hashText(`${HEADED} `));
  assert.notEqual(hashText(""), hashText("a"));
});

test("lineAt counts from one and lands on the right line", () => {
  const content = "alpha\nbeta\ngamma";
  assert.equal(lineAt(content, 0), 1);
  assert.equal(lineAt(content, content.indexOf("beta")), 2);
  assert.equal(lineAt(content, content.indexOf("gamma")), 3);
  assert.equal(lineAt(content, content.length), 3);
});

test("the support check reads content words, not function words", () => {
  const span: TextEvidence = {
    kind: "text",
    id: "x",
    sourceId: "a.md",
    sourceType: "markdown",
    path: "a.md",
    startLine: 1,
    endLine: 1,
    startOffset: 0,
    endOffset: 10,
    text: "Uploads are validated before storage.",
    normalizedText: "Uploads are validated before storage.",
    contentHash: "h",
  };
  // Function words are not evidence of anything, so they are not checked.
  assert.equal(verifyClaim("Although these would otherwise", [span]).checked, 0);
  // A content word that is genuinely absent is caught.
  assert.equal(verifyClaim("Uploads are throttled", [span]).ok, false);
  assert.equal(verifyClaim("Uploads are validated", [span]).ok, true);
  // The glue list must not quietly swallow domain vocabulary.
  for (const word of ["upload", "retry", "auth", "worker", "queue", "schema", "index"]) {
    assert.equal(GLUE.has(word), false, `domain word must stay checkable: ${word}`);
  }
});

// ------------------------------------------------------------------- the demo

test("the demo pack answers under the same rules as material a user brings", () => {
  // There is one definition of "supported". The built-in pack gets no scripted
  // answers and no exemption from the word-level check, so whatever it says in a
  // demo is what the engine would say about anyone's files.
  const chunks = buildChunks(NORTHSTAR);
  const spoken = questionChips(NORTHSTAR).map((query) => ({
    query,
    card: localCard(query, retrieve(query, chunks), NORTHSTAR, 0, null),
  }));

  for (const { query, card } of spoken) {
    if (!card.say) continue;
    assert.ok(card.evidence?.length, `no evidence behind: ${query}`);
    for (const item of card.evidence ?? []) {
      assert.equal(evidenceIsCurrent(item, sourcesOf(NORTHSTAR)), true, `stale evidence: ${query}`);
    }
    // The claim survives the check real material is held to, structural
    // vocabulary aside — no fixture branch is standing in for it.
    const structural = [NORTHSTAR.name, ...NORTHSTAR.files.map((f) => f.path)];
    assert.equal(
      verifyClaim(card.say, card.evidence ?? [], structural).ok,
      true,
      `demo answer is not word-supported: ${query} -> ${card.say}`,
    );
  }

  // A demo that answers nothing is not a demo. Every built-in chip should land.
  const silent = spoken.filter((s) => !s.card.say).map((s) => s.query);
  assert.deepEqual(silent, [], `built-in chips went silent: ${silent.join(" | ")}`);
});

test("no citation anywhere in the demo renders a coordinate it does not have", () => {
  const chunks = buildChunks(NORTHSTAR);
  const cites: Citation[] = questionChips(NORTHSTAR).flatMap(
    (query) => localCard(query, retrieve(query, chunks), NORTHSTAR, 0, null).citations,
  );
  assert.ok(cites.length > 0);
  assert.ok(cites.some((c) => c.kind === "commit"), "the demo should exercise both kinds");
  assert.ok(cites.some((c) => c.kind === "file"));

  for (const cite of cites) {
    const rendered = citationText(cite);
    if (cite.kind === "commit") {
      assert.doesNotMatch(rendered, /:\d+/, `commit citation invented a line: ${rendered}`);
      continue;
    }
    if (cite.kind === "document") {
      assert.match(rendered, / · Page \d+/);
      continue;
    }
    // A file citation's line must actually be inside the file it names.
    const file = NORTHSTAR.files.find((f) => f.path === cite.path);
    assert.ok(file, `cited a file not in the pack: ${cite.path}`);
    const lines = file.content.split("\n").length;
    assert.ok(cite.line >= 1 && cite.line <= lines, `line out of range: ${rendered}`);
  }
});
