import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../../context/index-versions.ts";
import { buildDocumentChunks } from "../../document/chunk.ts";
import type { NormalizedDocument, NormalizedPage } from "../../document/types.ts";
import type { RepoPack } from "../../repo/types.ts";
import { localCard } from "../local-card.ts";
import { retrieve } from "../retrieve.ts";
import {
  buildQuestionContract,
  claimFitsContract,
  contractBlocksAll,
  sourceHitEligible,
} from "../question-contract.ts";
import type { ThreadContext } from "../thread.ts";

function page(text: string, pageNumber = 1): NormalizedPage {
  return {
    pageNumber,
    text,
    items: [],
    segments: [],
    readingOrder: "single-column",
    usefulItemCount: 1,
    index: text.trim() ? "full" : "skipped",
  };
}

function doc(partial: Partial<NormalizedDocument> & { path: string; sourceId: string }): NormalizedDocument {
  const pages = partial.pages ?? [page("Serializable isolation prevents lost outcomes.")];
  return {
    contextId: "ctx",
    contentHash: partial.sourceId,
    type: "pdf",
    parserVersion: PDF_PARSER_VERSION,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: pages.length,
    outline: [],
    readiness: "ready",
    ...partial,
    pages,
  };
}

const PACK: RepoPack = { id: "qc", name: "qc", description: "qc", files: [], commits: [] };

const BERT = doc({
  sourceId: "bert.pdf",
  path: "bert.pdf",
  pages: [page("BERT: Bidirectional Encoder Representations from Transformers. Jacob Devlin Ming-Wei Chang.")],
});
const RESNET = doc({
  sourceId: "resnet.pdf",
  path: "resnet.pdf",
  pages: [page("We present a residual learning framework for ImageNet.")],
});
const LORA = doc({
  sourceId: "lora.pdf",
  path: "lora.pdf",
  pages: [page("LoRA freezes the pre-trained model weights and injects low-rank matrices.")],
});
const CISA = doc({
  sourceId: "cisa-ransomware.pdf",
  path: "cisa-ransomware.pdf",
  pages: [page("Ransomware is a form of malware designed to encrypt files.")],
});
const NIST145 = doc({
  sourceId: "nist-800-145.pdf",
  path: "nist-800-145.pdf",
  pages: [page("NIST definition of cloud computing. Hybrid cloud is a composition of two or more clouds.")],
});
const NIST207 = doc({
  sourceId: "nist-800-207.pdf",
  path: "nist-800-207.pdf",
  pages: [page("Zero trust architecture. Disclose such patent claims to ITL.")],
});
const NIST63B = doc({
  sourceId: "nist-800-63b.pdf",
  path: "nist-800-63b.pdf",
  pages: [page("A memorized secret is commonly referred to as a password.")],
});
const CS229 = doc({
  sourceId: "cs229-notes.pdf",
  path: "cs229-notes.pdf",
  pages: [page("This function h is called a hypothesis.", 1)],
});
const SCANNED = doc({
  sourceId: "scanned.pdf",
  path: "scanned.pdf",
  readiness: "scanned",
  pages: [page("", 1)],
});
const ENCRYPTED = doc({
  sourceId: "encrypted.pdf",
  path: "encrypted.pdf",
  readiness: "unreadable",
  pages: [],
});
const IRS = doc({
  sourceId: "irs-p15.pdf",
  path: "irs-p15.pdf",
  readiness: "refused",
  pages: [],
});

const CORPUS = [BERT, RESNET, LORA, CISA, NIST145, NIST207, NIST63B, CS229, SCANNED, ENCRYPTED, IRS];

test("df=0: absent required term stays required and rejects a tempting claim", () => {
  const contract = buildQuestionContract("What salary did the LoRA authors disclose?", CORPUS);
  assert.ok(contract.subject.requiredTerms.includes("salary"));
  assert.equal(contract.subject.requiredTerms.includes("lora"), false);
  assert.equal(claimFitsContract("Disclose such patent claims to ITL.", contract), false);
  assert.equal(claimFitsContract("The LoRA authors disclosed a salary of 1 dollar.", contract), true);
});

test("df=0: framing word does not become required merely because it is absent", () => {
  const contract = buildQuestionContract("Please tell me what ransomware is according to the guide?", CORPUS);
  assert.equal(contract.subject.requiredTerms.includes("please"), false);
  assert.equal(contract.subject.requiredTerms.includes("tell"), false);
  assert.ok(contract.subject.requiredTerms.includes("ransomware"));
});

test("source selector: unique filename keeps only that source", () => {
  const contract = buildQuestionContract("What does the BERT paper say about transformers?", CORPUS);
  assert.equal(sourceHitEligible("bert.pdf", contract), true);
  assert.equal(sourceHitEligible("resnet.pdf", contract), false);
});

test("source selector: explicit different source is rejected", () => {
  const contract = buildQuestionContract("What architecture does the BERT paper propose?", CORPUS);
  assert.equal(sourceHitEligible("resnet.pdf", contract), false);
  assert.equal(claimFitsContract("We present a residual learning framework for ImageNet.", contract), false);
});

test("source selector: ambiguous paper does not bind a sourceId", () => {
  const papers = [BERT, RESNET, LORA];
  const contract = buildQuestionContract("What does the paper say about isolation?", papers);
  assert.equal(contract.sourceSelector?.sourceIds.length, 0);
  assert.equal(contractBlocksAll(contract), null);
});

test("source selector: thread-resolved that paper is only the prior source", () => {
  const thread: ThreadContext = {
    utteranceId: "u1",
    canonical: "What does BERT stand for?",
    shape: "what",
    subject: ["bert"],
    claim: "Bidirectional Encoder Representations from Transformers.",
    files: ["bert.pdf"],
    sourceIds: ["bert.pdf"],
    entities: ["bert"],
    at: Date.now(),
  };
  const contract = buildQuestionContract("What does that paper say about masking?", CORPUS, thread);
  assert.deepEqual(contract.sourceSelector?.sourceIds, ["bert.pdf"]);
  assert.equal(sourceHitEligible("resnet.pdf", contract), false);
});

test("source selector: scanned / refused selected source does not fall back", () => {
  const scanned = buildQuestionContract("What does the scanned PDF say about isolation?", CORPUS);
  assert.ok(contractBlocksAll(scanned));
  const enc = buildQuestionContract("What password opens the encrypted PDF?", CORPUS);
  assert.ok(contractBlocksAll(enc));
  const irs = buildQuestionContract("What is the sample employee's SSN in Publication 15?", CORPUS);
  assert.ok(contractBlocksAll(irs));
});

test("source selector: ambiguous NIST is named and blocks all", () => {
  const contract = buildQuestionContract("How does NIST define cloud computing?", CORPUS);
  assert.equal(contract.sourceSelector?.strength, "named");
  assert.ok(contractBlocksAll(contract));
});

test("predicate: cost + generic description rejects", () => {
  const contract = buildQuestionContract("How much does the NIST cloud service cost per month?", [NIST145]);
  assert.equal(contract.predicate?.kind, "cost");
  assert.equal(claimFitsContract("NIST definition of cloud computing.", contract), false);
});

test("predicate: phone + person name rejects", () => {
  const contract = buildQuestionContract("What's Jacob Devlin's phone number?", CORPUS);
  assert.equal(contract.predicate?.kind, "contact");
  assert.equal(claimFitsContract("Jacob Devlin Ming-Wei Chang Kenton Lee", contract), false);
  assert.equal(claimFitsContract("Jacob Devlin's phone number is 555-010-0199.", contract), true);
});

test("predicate: storage-location + general security prose rejects", () => {
  const contract = buildQuestionContract("Where does the policy say we store customer passwords in plaintext?", [NIST63B, NIST207]);
  assert.equal(contract.predicate?.kind, "location");
  assert.equal(claimFitsContract("Zero trust architecture assumes an attacker is present.", contract), false);
});

test("predicate: recommendation + mere mention rejects", () => {
  const contract = buildQuestionContract("Which GPU vendor should we buy from for Transformers?", [BERT, LORA]);
  assert.equal(contract.predicate?.kind, "recommendation");
  assert.equal(claimFitsContract("BERT: Pre-training of Deep Bidirectional Transformers", contract), false);
});

test("answer type: quantity needs a quantity relation", () => {
  const contract = buildQuestionContract("What is the annual growth rate?", CORPUS);
  assert.equal(contract.answerExpectation, "quantity");
  assert.equal(claimFitsContract("48th Annual Meeting of the Association", contract), false);
  const glue = buildQuestionContract("What GLUE score did they report?", [BERT]);
  assert.equal(glue.answerExpectation, "quantity");
  assert.equal(claimFitsContract("Tasks, including pushing the GLUE score to", glue), false);
  assert.equal(claimFitsContract("BERT reaches a GLUE score of 80.5.", glue), true);
});

test("required verb: first action must be the asked relation", () => {
  const freeze = buildQuestionContract("What does LoRA freeze?", [LORA]);
  assert.equal(freeze.requiredVerb, "freeze");
  assert.equal(
    claimFitsContract(
      "We limit our study to only adapting the attention weights and freeze the MLP modules.",
      freeze,
    ),
    false,
  );
  assert.equal(claimFitsContract("LoRA freezes the pre-trained model weights.", freeze), true);
  assert.equal(
    claimFitsContract("We can freeze the shared model and efficiently switch tasks.", freeze),
    false,
  );
  const solve = buildQuestionContract("How do they solve nested loops?", [LORA]);
  assert.equal(solve.requiredVerb, "solve");
  assert.equal(claimFitsContract("Cover a program, representing nested loops as nested trace trees.", solve), false);
  assert.equal(claimFitsContract("They solve nested loops by building nested trace trees.", solve), true);
  const implement = buildQuestionContract("Which interpreter did they implement on?", [LORA]);
  assert.equal(implement.requiredVerb, "implement");
  assert.equal(
    claimFitsContract("The LIR also encodes all the stores that the interpreter would do to its data stack.", implement),
    false,
  );
});

test("sayability: smashed sentence edge is not a claim", () => {
  const contract = buildQuestionContract("Why operate at the granularity of loops?", [LORA]);
  assert.equal(
    claimFitsContract(
      "Ular since they are expressive, accessible to non-experts, and make piler operates at the granularity of individual loops.",
      contract,
    ),
    false,
  );
});

test("answer type: who needs ownership, where needs location, why needs rationale, failure needs consequence", () => {
  const who = buildQuestionContract("Who owns the Bitcoin project?", CORPUS);
  assert.equal(claimFitsContract("Satoshi Nakamoto satoshin@gmx.com", who), false);
  const where = buildQuestionContract("Where is customer data stored?", CORPUS);
  assert.equal(claimFitsContract("Customer data is encrypted at rest.", where), false);
  assert.equal(claimFitsContract("Customer data is stored in the vault.", where), true);
  const why = buildQuestionContract("Why do they scale the dot products?", CORPUS);
  assert.equal(claimFitsContract("We scale the dot products.", why), false);
  assert.equal(claimFitsContract("We scale the dot products because large magnitudes push softmax.", why), true);
  const fail = buildQuestionContract("What happens to customer passwords when the retry fails?", CORPUS);
  assert.equal(claimFitsContract("When the VM fails to finish a trace start", fail), false);
});

test("enumeration: three-item request + one item rejects; coherent list eligible", () => {
  const contract = buildQuestionContract("What are the three pillars?", CORPUS);
  assert.equal(contract.enumeration?.requested, true);
  assert.equal(contract.enumeration?.expectedCount, 3);
  assert.equal(claimFitsContract("The three pillars are:", contract), false);
  assert.equal(claimFitsContract("Identity, Devices, and Data are the only two we named.", contract), false);
  assert.equal(
    claimFitsContract("The pillars are Identity, Devices, and Data.", contract),
    true,
  );
});

test("enumeration: unbounded which-items still needs multiple members", () => {
  const contract = buildQuestionContract("Which isolation levels are listed?", CORPUS);
  assert.equal(contract.enumeration?.requested, true);
  assert.equal(claimFitsContract("Serializable isolation prevents lost outcomes.", contract), false);
  assert.equal(
    claimFitsContract("The isolation levels are:\nread committed\nrepeatable read\nserializable", contract),
    true,
  );
});

test("claim-level: chunk subject elsewhere does not admit a claim that lacks it", () => {
  const contract = buildQuestionContract("What does LoRA freeze?", [LORA]);
  assert.ok(contract.subject.requiredTerms.includes("freeze"));
  assert.equal(claimFitsContract("LoRA injects low-rank matrices.", contract), false);
  assert.equal(claimFitsContract("LoRA freezes the pre-trained model weights.", contract), true);
});

test("mixed documents: higher-ranked wrong source is ineligible", () => {
  const contract = buildQuestionContract("What is ransomware according to the guide?", CORPUS);
  assert.equal(sourceHitEligible("nist-800-207.pdf", contract), false);
  assert.equal(sourceHitEligible("cisa-ransomware.pdf", contract), true);
});

test("silence: lexically tempting unanswerable does not fit", () => {
  const contract = buildQuestionContract("What unpublished accuracy is hidden in Figure 1?", CORPUS);
  assert.equal(claimFitsContract("Figure 5 presents MNLI Dev accuracy after fine-tuning.", contract), false);
});

test("thread pointer without a unique prior source blocks admission", () => {
  const contract = buildQuestionContract("What does that paper say about masking?", CORPUS);
  assert.equal(contract.needsThreadSource, true);
  assert.ok(contractBlocksAll(contract));
});

test("localCard: scanned selector does not speak from another PDF", () => {
  const ready = doc({
    sourceId: "lecture.pdf",
    path: "lecture.pdf",
    pages: [page("Serializable isolation prevents lost outcomes.")],
  });
  const scanned = SCANNED;
  const documents = [ready, scanned];
  const chunks = documents.flatMap(buildDocumentChunks);
  const ctx = {
    document: (id: string) => documents.find((item) => item.sourceId === id),
    documents,
  };
  const card = localCard(
    "What does the scanned PDF say about isolation?",
    retrieve("What does the scanned PDF say about isolation?", chunks),
    PACK,
    0,
    null,
    ctx,
  );
  assert.equal(card.say, null);
});

test("localCard: LoRA salary does not speak a patent-disclose sentence", () => {
  const documents = [LORA, NIST207];
  const chunks = documents.flatMap(buildDocumentChunks);
  const ctx = {
    document: (id: string) => documents.find((item) => item.sourceId === id),
    documents,
  };
  const card = localCard(
    "What salary did the LoRA authors disclose?",
    retrieve("What salary did the LoRA authors disclose?", chunks),
    PACK,
    0,
    null,
    ctx,
  );
  assert.equal(card.say, null);
});
