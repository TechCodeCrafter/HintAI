import assert from "node:assert/strict";
import { test } from "node:test";

import type { RepoPack } from "@/lib/repo/types";
import { extractDocumentClaim } from "../document-card.ts";
import { shapeOf } from "../intent.ts";
import {
  buildQuestionContract,
  claimFitsContract,
} from "../question-contract.ts";
import { buildChunks, retrieve } from "../retrieve.ts";
import { isFieldLine, sayable } from "../say.ts";

// Fix Pack 1: doc-demo killers (macbeth + offer letter + erstuff MD).

test("who-is reads as definition, who-owns stays ownership", () => {
  assert.equal(shapeOf("who is macbeth"), "what");
  assert.equal(shapeOf("Who is Macbeth?"), "what");
  assert.equal(shapeOf("who is REDSHEEL"), "what");
  assert.equal(shapeOf("Who touched the auth flow?"), "who");
  assert.equal(shapeOf("Who owns isolation?"), "who");
});

test("phone field: generic words are not required, short line fits", () => {
  const contract = buildQuestionContract("what is the phone number", []);
  assert.equal(contract.predicate?.kind, "contact");
  assert.ok(!contract.subject.requiredTerms.includes("number"), "number must be optional");
  assert.ok(!contract.subject.requiredTerms.includes("phone"), "phone must be optional");
  assert.equal(contract.needsDefinitionCopula, false);
  assert.equal(
    claimFitsContract("Phone: 9931607655", contract, "REDSHEEL\nPhone: 9931607655"),
    true,
  );
});

test("company field: header with no overlap words still fits", () => {
  const contract = buildQuestionContract("what is the company name", []);
  assert.ok(!contract.subject.requiredTerms.includes("company"));
  assert.ok(!contract.subject.requiredTerms.includes("name"));
  assert.equal(contract.needsDefinitionCopula, false);
  assert.equal(claimFitsContract("REDSHEEL", contract, "REDSHEEL\nBhopal Anandnagar"), true);
});

test("spoken gates: strict rejects short lines, field allows them", () => {
  assert.equal(sayable("Phone: 9931607655"), null);
  assert.equal(sayable("REDSHEEL"), null);
  assert.ok(sayable("Phone: 9931607655", true));
  assert.ok(sayable("REDSHEEL", true));
  assert.equal(isFieldLine("This is the current product plan for erstuff."), false);
});

test("extract: phone and header lines are claimable for field questions", () => {
  const chunk = "REDSHEEL\nBhopal Anandnagar\nPhone: 9931607655";
  const phoneContract = buildQuestionContract("what is the phone number", []);
  const phoneClaim = extractDocumentClaim(chunk, ["phone", "number"], [], [], phoneContract);
  assert.ok(phoneClaim, "phone line must extract");
  assert.match(phoneClaim.text, /9931607655/);

  const companyContract = buildQuestionContract("what is the company name", []);
  const companyClaim = extractDocumentClaim(chunk, ["company", "name"], [], [], companyContract);
  assert.ok(companyClaim, "company header must extract");
});

test("retrieval tolerates a single-char typo", () => {
  const pack: RepoPack = {
    id: "typo",
    name: "typo",
    description: "typo",
    commits: [],
    files: [
      {
        path: "me.md",
        language: "md",
        content: "I have five years of experience building developer tools.",
      },
      { path: "notes/a.md", language: "md", content: "Grocery list and weekend plans." },
      { path: "notes/b.md", language: "md", content: "Meeting notes about the office move." },
      { path: "notes/c.md", language: "md", content: "Ideas for the team offsite." },
      { path: "notes/d.md", language: "md", content: "Recipes and cooking experiments." },
    ],
  };
  const chunks = buildChunks(pack);
  const hits = retrieve("experince", chunks);
  assert.ok(hits.length > 0, "experince must reach experience");
  assert.equal(hits[0].path, "me.md");
});

test("retrieval: 'what this product does' reaches the product file", () => {
  const pack: RepoPack = {
    id: "erstuff",
    name: "erstuff",
    description: "erstuff",
    commits: [],
    files: [
      {
        path: "erstuff-full-plan.md",
        language: "md",
        content:
          "This is the current product plan for erstuff.\n\nerstuff is a developer-tool discovery platform.",
      },
    ],
  };
  const chunks = buildChunks(pack);
  const hits = retrieve("what this product does", chunks);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].path, "erstuff-full-plan.md");
});
