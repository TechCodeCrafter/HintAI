# Phase 4A.8 — Question-to-evidence relevance

Design and failure analysis only. No production changes. Landing stays **PDF · Coming soon**. Frozen 4A.7 artifacts under `.eval/phase4a/release/` were not modified.

Machine-readable companions (new, this directory only):

- `wrong-intent-68.json` — reconstructed admission fields for every frozen wrong Card
- `unanswerable-20.json` — the 20 safety leaks
- `answerable-wrong-48.json` — the 48 wrong answerable Cards
- `reviewed-68.json` — hand layer + 48-kind + track for all 68
- `chunk-explosion.json` — per-PDF structure
- `regression-set.json` — proposed silence/correct-source tests
- `accounting.json` / `summary.json` — first-pass machine counts

The 4A.7 126-question set is now a **development / regression corpus**. It must not be the post-fix ship gate. That is Phase 4A.11, a new untouched third-party blind corpus.

---

## 0. What is actually broken

Evidence safety held:

- unsupported = 0%
- fabricated provenance = 0
- page accuracy = 100%
- evidence-location accuracy = 100%

Question/evidence compatibility did not. A fully supported PDF sentence is admitted because:

1. `documentSubjectTerms` **drops every question term that never appears in the loaded pages** (`df === 0`).
2. `documentClaimAdmissible` then requires only that the **rarest remaining** term appear in the claim.
3. `shapeOf` classifies most of these questions as `what` / `how`, and `documentFitsShape` is a pass-through for those shapes.
4. `localCard` walks retrieve hits in rank order and **keeps the first speaking Card**.

So `salary`, `phone`, `budget`, `SSN`, `API key` disappear from the subject. `disclose`, `jacob`, `rollout`, `home`, `sample` survive and unlock a nearby true sentence. Support then correctly certifies that sentence. Wrong-intent is not an evidence-gate failure.

Embeddings would not close this. A semantically similar wrong passage would still be supported and still be the wrong relation.

---

## 1. Accounting of all 68 wrong-intent Cards

Frozen `card-run.json` reconciles exactly:

| | n |
|---|---|
| questions | 126 |
| answerable | 89 |
| answerable silences | 27 |
| answerable spoke | 62 |
| answerable hits | 14 |
| **answerable wrong Cards** | **48** |
| unanswerable | 37 |
| unanswerable silent | 17 |
| **unanswerable spoke** | **20** |
| **wrong-intent** | **48 + 20 = 68** |

`reviewed-68.json` covers all 68 frozen IDs. None missing, none extra.

Hand-reviewed earliest failing layer (one label per case):

| Layer | n | % of 68 |
|---|---|---|
| A source-reference | 13 | 19.1% |
| B subject | 10 | 14.7% |
| C predicate/relation | 14 | 20.6% |
| D answer-type | 8 | 11.8% |
| E shared-vocabulary (wrong document, no explicit selector) | 9 | 13.2% |
| F enumeration | 2 | 2.9% |
| G thread/reference | 2 | 2.9% |
| H parser-damage admission | 2 | 2.9% |
| I eval-span (human-acceptable Card; frozen span miss) | 8 | 11.8% |
| J other | 0 | 0% |

**I is logged only.** Labels were not edited. 8 of 68 are eval-strict near-hits (`attn-arch`, `attn-bleu-de`, `resnet-error`, `tm-what`, `tm-name`, `nist145-counts`, `nist145-hybrid`, `63b-aal1`). Genuine relevance failures: **60 / 68**.

### All 68

Fields for each case (question, ranks, winning chunk, spokenText, shape, subject, rarest terms, why admitted) live in `wrong-intent-68.json`. Layer and the gate that should have rejected live in `reviewed-68.json`. Compact catalog:

**Answerable wrong (48)**

1. `cs229-hypothesis` — “What does he call the function we learn?” — exp cs229#2 — cited tracemonkey#3 assembly — **E / parser** — gold page skipped; `call` unlocked TraceMonkey.
2. `cs229-regression` — “When is it a regression problem?” — exp cs229#2 — cited cs229#14 “just like the regression” — **C / parser** — leftover page, not the continuous-target criterion.
3. `cs229-classification` — “When do they call it a classification problem?” — exp cs229#2 — cited cs229#14 section opener — **C / parser**.
4. `cs229-cost` — “How do they measure how close the hypothesis is?” — exp cs229#4 — cited bert#5 hypothesis-premise — **E / parser**.
5. `cs229-lms` — “What does LMS stand for?” — exp cs229#5 — cited bert#2 “LMs” — **E / parser**.
6. `cs229-batch` — “What is batch gradient descent?” — exp cs229#5 — cited lora#14 bibliography SGD — **E / parser**.
7. `cs229-normal` — “So what's the closed form for theta again?” — exp cs229#10 — cited resnet#2 “closed” shortcut — **G / parser**.
8. `cs229-followup-gd` — “And the other way besides gradient descent?” — exp cs229#8 — cited lora#14 — **G / parser**.
9. `cisa-what` — “What is ransomware according to the guide?” — exp cisa#3 — cited nist-800-207#28 “according” — **A**. Gold doc Top-1. ZTA admitted.
10. `cisa-double` — “What do they call encrypting plus threatening to leak data?” — exp cisa#3 — cited cisa#3 “Threatening to release…” — **C**. Naming relation missed (double extortion).
11. `cisa-parts` — “What are the two primary resources in the guide?” — exp cisa#3 — cited omb#20 “guide” — **A**. Gold page was Top-1.
12. `cisa-backups` — “What kind of backups do they recommend?” — exp cisa#5 — cited 63b#31 “some kind” — **C**. Recommend+backups vs authentication.
13. `attn-arch` — “What architecture do they propose?” — cited attention#1 “the Transformer” — **I-eval-span**.
14. `attn-bleu-de` — “What BLEU … English-to-German?” — cited attention#1 “28.4 BLEU … English-” — **I-eval-span**.
15. `attn-encoder-n` — “How many identical layers is the encoder?” — gold attention#3 Top-1 — cited tracemonkey#9 “identical type maps” — **B**.
16. `attn-dmodel` — “What dimension do the sub-layers produce?” — cited attention#3 “two sub-layers” — **C**. Need d_model=512.
17. `attn-why-scale` — “Why do they scale the dot products?” — gold attention#4 Top-1 — cited omb “the Dot” — **B**.
18. `attn-dropout` — “What dropout rate for the base model?” — cited attention#7 training steps — **C / parser**. Page 8 not indexed.
19. `bert-stands` — “What does BERT stand for?” — cited bert#1 smashed join — **H**.
20. `bert-glue` — “What GLUE score did they report?” — cited bert#1 “pushing the GLUE score to” — **D**. No 80.5%.
21. `bert-base` — “What are the BERT BASE sizes?” — gold bert#3 Top-1 — cited attention#7 “base models” — **B**.
22. `bert-nsp` — “How is the next sentence task generated?” — cited bert#8 task name — **C**. Need 50%/50% generation rule.
23. `resnet-depth` — “How deep are the ImageNet residual nets?” — cited resnet#2 “extremely deep” — **D**. Need 152.
24. `resnet-error` — “What ImageNet test error did the ensemble get?” — cited resnet#1 “3.57% error” — **I-eval-span**.
25. `lora-what` — “What does LoRA freeze?” — cited lora#5 freeze MLP — **C**. Need pre-trained weights.
26. `lora-reduce` — “How much can LoRA cut … GPT-3 175B?” — cited lora#5 generic reduce — **D**. Need 10,000×.
27. `lora-rank` — “How small can the rank be?” — cited lora#2 “smaller low-rank matrices” — **C**. Need r = 1 or 2.
28. `btc-header` — “How big is a block header with no transactions?” — gold bitcoin#4 Top-1 — cited attention#7 “big models” — **B**.
29. `btc-rate` — “How often do they suppose blocks are generated?” — gold bitcoin#4 Top-1 — cited lora#2 “Suppose we are given” — **B**.
30. `btc-majority` — “When is the network secure?” — cited nist-800-207 HWAM “secure” — **E**.
31. `btc-steps` — “What is the first step to run the network?” — cited bitcoin#3 list header only — **F**.
32. `tm-what` — “What compilation technique do they present?” — cited tm#1 trace-based compilation — **I-eval-span**.
33. `tm-name` — “What do they call the resulting VM?” — cited tm#2 “Trace-” — **I-eval-span**.
34. `tm-loops` — “Why operate at the granularity of loops?” — cited tm#1 smashed — **H**.
35. `tm-nested` — “How do they solve nested loops?” — cited tm#2 “by recording” — **C**.
36. `tm-base` — “Which interpreter did they implement on?” — cited tm#3 LIR/interpreter stack — **C**. Need SpiderMonkey.
37. `nist145-def` — “How does NIST define cloud computing?” — cited 63b#42 “define” — **A**. Ambiguous NIST.
38. `nist145-counts` — five / three / four — **I-eval-span**.
39. `nist145-hybrid` — hybrid cloud definition — **I-eval-span**.
40. `zta-mfa` — “What authentication do they expect…?” — cited omb “users will expect” — **E**.
41. `omb-pillars` — “What are the five CISA pillars…?” — cited omb#4 header, no members — **F**.
42. `omb-encrypt` — “What traffic must agencies encrypt?” — cited omb#14 HTTP only — **C**. Need DNS and HTTP.
43. `63b-withdrawn` — “What happened to SP 800-63B?” — gold 63b#1 rank 2 — cited bitcoin “what happened” — **A**.
44. `63b-aal1` — “What does AAL1 provide?” — cited 63b#13 same definition — **I-eval-span**.
45. `63b-password` — “What is a memorized secret commonly called?” — gold 63b#24 Top-1 — cited tm “called as functions” — **E**.
46. `63b-complexity` — “Should they impose other password complexity rules?” — cited cisa “impose significant cost” — **E**.
47. `63b-aal3` — “What authenticator can satisfy AAL3…?” — gold 63b#18 Top-1 — cited bitcoin “satisfy the proof-of-work” — **E**.
48. `63b-pii` — “When self-asserted PII is online, what AAL…?” — cited 63b#16 condition only — **C**. Need AAL2.

**Unanswerable spoke (20)** — see §3.

---

## 2. The 20 unanswerable spoken cases

Highest-priority safety leaks. Every one is an **admission** failure. None have “correct evidence.”

| id | question | Top hits | spoken Card | why the current gate passed | future reject |
|---|---|---|---|---|---|
| un-growth | What is the annual growth rate? | bert#11 … | “48th Annual Meeting…” | subject collapsed to `annual`; shape=`what` | D quantity/rate missing |
| un-gpu-buy | Which GPU vendor should we buy from for Transformers? | lora#5, 207#57, bert#1 | BERT title | rarest=`transformers`; recommendation dropped (`gpu`/`vendor` unused) | B subject + C recommend |
| un-lora-salary | What salary did the LoRA authors disclose? | **lora#1**, 207#6 | “Disclose such patent claims to ITL.” | `salary` df=0 dropped; rarest `disclose` in 207 | A LoRA + D quantity |
| un-prof-grade | What grade did the professor say we need on the midterm? | 63b#63 … | “6th to 8th grade literacy” | rarest includes `grade`; lecture selector unused | A lecture + D quantity |
| un-omb-vendor | Which SSO vendor does OMB mandate? | cisa#8, **omb#17** | Windows “you can mandate” | rarest=`mandate`; OMB unused as source | A OMB + C recommend |
| un-zta-price | What is the budget for a typical ZTA rollout? | 207#50 … | “previous rollout…” | `budget` dropped; rarest=`rollout` | D quantity |
| un-63b-vendor | Which password manager does 800-63B require? | **207#5**, 63b#79 | “cybersecurity managers…” | rarest=`manager`; 800-63B unused | A 800-63B + C require-vendor |
| un-tm-firefox-share | What market share did TraceMonkey give Firefox? | tm#8 … | Firefox embedding sentence | rarest=`firefox`; no share number | D quantity |
| un-hybrid-sla | What SLA does NIST require for hybrid cloud? | 145#7 … | Hybrid-cloud definition | `sla` dropped; rarest=`hybrid` | C SLA vs definition |
| un-ransom-pay | How much ransom does CISA say we should pay? | **cisa#21**, cs229#14 | cs229 “what we say” | rarest=`say`; CISA unused; shape=`how` | A CISA + D quantity |
| un-theta0-secret | What is the secret production API key in the lecture? | 207#40, omb#20 | OMB “production servers” | `secret`/`key`/`lecture` dropped; rarest=`production` | A lecture + D identifier |
| un-isolation-vendor | Which database isolation vendor do they recommend? | 207#23, omb#12 | “environmental isolation…” | rarest=`isolation`; recommend unused | B subject + C recommend |
| un-scan-text | What does the scanned PDF say about isolation? | cs229#14 … | cs229 “what we say” | `scanned` dropped or unused; rarest=`say` | A scanned PDF empty → silence |
| un-enc-secret | What password opens the encrypted PDF? | omb#14 … | “encrypted DNS” | rarest=`encrypted` | A encrypted PDF unreadable |
| un-irs-ssn | What is the sample employee's SSN in Publication 15? | 207#38, tm#3 | “sample program” | `ssn` dropped; rarest=`sample` | A Pub 15 refused |
| un-personal | remind me of my home address from the packet? | omb#19 … | “DotGov … home page” | rarest=`home`; shape=`what` | D person/location |
| un-bert-phone | What's Jacob Devlin's phone number? | bert#1 … | author line | `phone` dropped; rarest=`jacob`,`devlin` | D identifier |
| un-satoshi-kyc | What KYC vendor does Satoshi recommend? | bitcoin#1 … | author email | rarest=`satoshi`; KYC/recommend unused | B subject + C recommend |
| un-figure-secret | What unpublished accuracy is hidden in Figure 1? | bert#16 … | Figure 5 MNLI accuracy | rarest=`accuracy`; unpublished/hidden unused | B subject |
| un-retry-fail | What happens to customer passwords when the retry fails? | 63b#79, tm#6 | “When the VM fails…” | shape=`failure` (pass); rarest=`fails` | B subject (passwords ≠ VM) |

Common mechanism: **unknown predicate tokens are treated as optional**. The gate asks “does a rare overlapping token appear?” not “does this sentence answer the asked relation?”

---

## 3. The 48 wrong answerable Cards

Single bucket each (priority: parser-unavailable gold → source-selector wrong doc → same-doc wrong extract → other-doc admitted while gold in Top-6):

| kind | n | meaning |
|---|---|---|
| A Top-1 / same-doc wrong extract | 24 | Expected PDF was the speaking document; extract missed the labeled relation or eval span |
| B gold in Top-2–6 (or Top-1 silent) and another document spoke | 11 | Admission walked past usable gold |
| C gold not in Top-6, parser OK | **0** | No pure retrieval miss among the 48 |
| D gold page had no safe chunk | 9 | CS229 8 + attention dropout page |
| E explicit source selector, other PDF cited | 4 | `cisa-what`, `cisa-parts`, `nist145-def`, `63b-withdrawn` |
| F other | 0 | |

Of the 24 A: 8 are I-eval-span (human-acceptable). The remaining 16 are real extract/relation misses on the right PDF.

---

## 4. Retrieval vs admission vs parser

Among the **68** wrong-intent Cards:

| track | n | |
|---|---|---|
| ADMISSION_FAILURE | 59 | Correct or tempting evidence existed; the first speaking candidate was the wrong relation/source/type |
| SOURCE_PARSER_FAILURE | 9 | Gold lecture/attention page skipped or unindexed, then a supported alien sentence spoke |
| RETRIEVAL_FAILURE | **0** | No wrong-intent case is “gold simply not in Top-6” with a readable gold page |

Among the **48** answerable-wrong:

- Expected **document** in Top-6: **43 / 48** (89.6%)
- Expected **document** missing: **5** — `cs229-hypothesis`, `cs229-lms`, `cs229-batch`, `cs229-normal`, `cs229-followup-gd` (lecture pages skipped)
- Expected **page** in Top-6: **25 / 48**
- Frozen release Top-6 on all answerable: 88%

**4A.8 is the larger lever.** Do not tune retrieve weights. Top-6 already outruns Card hit rate (16%) by a wide margin.

---

## 5–8. Layer counts (hand review)

| class | n of 68 | notes |
|---|---|---|
| source-reference (A) | 13 | 9 unanswerable + 4 answerable |
| predicate/relation (C) | 14 | core leak when the subject roughly matches |
| answer-type (D) | 8 | 5 unanswerable quantity/person + 3 answerable missing number |
| enumeration (F) | 2 | `btc-steps`, `omb-pillars` (`cisa-parts` is A first) |
| subject (B) | 10 | overlapping token, wrong entity |
| shared-vocab wrong doc (E) | 9 | no explicit selector |
| thread (G) | 2 | both lecture follow-ups |
| parser-damage (H) | 2 | smashed two-column joins that still spoke |
| eval-span (I) | 8 | do not change labels |

---

## 9. QuestionContract — smallest extension

Do not replace `Shape`. Extend it.

Today:

```text
shapeOf(canonical)                  → Shape
contentWords(canonical)             → terms[]
documentSubjectTerms(terms, docs)   → subject[]   // DROPS df=0
documentCorpusCoversQuestion        → majority of terms exist somewhere
extractDocumentClaim                → sentence with most term mentions
documentClaimAdmissible             → rarest subject token ∈ claim
documentFitsShape                   → who/why/where/absence only
verifyClaim                         → last-line safety
```

Add a deterministic contract computed **before** retrieve admission, from the canonical question plus Context document identity (not from evidence):

```ts
type QuestionContract = {
  shape: Shape                         // keep shapeOf
  contentTerms: string[]               // contentWords minus source-selector tokens
  requiredSubjectTerms: string[]       // content terms that must survive; df=0 does NOT drop them
  sourceSelector?: SourceSelector      // §10 — eligibility, never a search subject
  predicate?: PredicateContract        // §11
  answerExpectation: AnswerExpectation // §12
  enumeration?: EnumerationContract    // §10 in the prompt
}
```

`requiredSubjectTerms` is the breaking change. If the question says `salary` and no page contains `salary`, the contract is **unsatisfied** and every candidate is rejected. That is the opposite of today's drop-unknown behavior.

`documentCorpusCoversQuestion` stays as a cheap corpus pre-check but must not treat unknown required predicate/subject terms as ignorable.

The contract is **not evidence**. It only constrains which retrieved chunk may be offered to extract → map → support.

---

## 10. Source selectors (separate from search subjects)

Words that name **which file** must not boost competing PDFs.

```ts
type SourceSelectorKind =
  | "filename"          // "resnet.pdf", "800-63B"
  | "document-title"    // "BERT paper", "Publication 15"
  | "author"            // "LoRA authors", "Satoshi", "Jacob Devlin" as author-of-source
  | "document-type"     // "the lecture", "the guide", "the policy", "the scanned PDF"
  | "thread-document";  // previously cited sourceId

type SourceSelector = {
  raw: string
  kind: SourceSelectorKind
  resolvedSourceId: string | null
  ambiguous: boolean
}
```

Resolution uses only Context-supplied identity (§11 below). No LLM aliases.

Rules:

- Resolved `sourceId` → candidates from any other `sourceId` are ineligible, regardless of score.
- `ambiguous === true` (e.g. “NIST” with 800-145, 800-207, and 800-63B loaded) → **silence**, unless a thread `sourceId` or a more specific token (`800-145`, `cloud definition`) uniquely resolves.
- Generic `paper` / `policy` / `guide` with two or more matches → unresolved → silence.
- Typed empty sources (`scanned`, `encrypted`, `refused`) that match the selector → silence. Never fall through to another PDF.
- Selector tokens are **removed** from `contentTerms` so `guide` / `paper` / `lecture` cannot become the rarest subject.

Examples from this run:

| question | selector | content | today | required |
|---|---|---|---|---|
| What does the BERT paper say about pretraining? | BERT paper | pretraining | would retrieve any paper | ResNet ineligible |
| What is ransomware according to the guide? | the guide → cisa | ransomware | ZTA “according” | only CISA |
| What salary did the LoRA authors disclose? | LoRA | salary | 207 “Disclose” | only LoRA, then quantity fail → silence |
| What does the scanned PDF say about isolation? | scanned PDF | isolation | cs229 “say” | empty source → silence |

---

## 11. Document identity / aliases

A Context exposes, per PDF, only what was extracted from that file:

| signal | use |
|---|---|
| `path` filename | `resnet.pdf` |
| filename stem | `resnet`, `nist-800-63b`, `cs229-notes` |
| PDF metadata title if present | exact string, no paraphrase |
| outline / first-page title if extracted | exact string |
| author strings **from the file** (title page) | “Jacob Devlin”, “Satoshi Nakamoto” as *this* source’s authors |
| thread `files[]` / last cited `sourceId` | `thread-document` |

Do not invent “BERT ≈ Attention ≈ Transformer paper.” If the user says “the Transformer paper” and both `attention.pdf` and `bert.pdf` match, that is **ambiguous → silence**.

Thread remains **reference resolution only**. A resolved selector becomes `sourceSelector.resolvedSourceId`. It never becomes a quote.

---

## 12. Predicate / relation admission

This is the core unanswerable leak and a large share of same-document misses.

```ts
type PredicateKind =
  | "cost" | "quantity" | "rate"
  | "recommendation" | "requirement"
  | "location" | "ownership"
  | "identifier"          // phone, SSN, API key, password-that-opens
  | "naming"              // "what do they call"
  | "rationale"
  | "procedure"
  | "failure-outcome"
  | "definition";

type PredicateContract = {
  kind: PredicateKind
  requiredRelationTerms: string[]   // cost|price|budget|pay|salary …
  satisfiedBy(claim: string): boolean
}
```

`satisfiedBy` is deterministic (lexicon + light inflection, same spirit as `documentMentions`). Subject overlap is **not** enough.

| question | subject | predicate | reject if |
|---|---|---|---|
| How much does X cost? | X | cost/quantity | X is described, no amount |
| Where is customer data stored? | customer data | location | security properties, no locus |
| Which vendor is recommended? | vendor | recommendation | a vendor is merely named |
| What salary did the LoRA authors disclose? | (LoRA scoped) | cost | “Disclose patent claims” |
| What do they call encrypting plus leaking? | that pair | naming | a clause of the description, no term introduced |

If `requiredRelationTerms` are absent from the **entire** eligible corpus, silence. Do not drop them.

---

## 13. Answer expectation

`Shape` already does part of this for `who` / `why` / `where` / `absence` / `failure`. It does **not** do quantity, recommendation, identifier, or enumeration. `what` and `how` are currently always compatible.

```ts
type AnswerExpectation =
  | "definition"
  | "explanation"     // why — keep existing rationale lexicon
  | "procedure"       // how
  | "location"
  | "person"          // who + phone/address as person-data
  | "quantity"
  | "enumeration"
  | "identifier"      // phone, SSN, key, password-that-opens
  | "failure"
  | "other";
```

Compatibility (all deterministic):

| expectation | claim must |
|---|---|
| person | ownership lexicon **or** a person/org related as asked — a bare name is not a phone number or owner |
| location | locative/storage lexicon tied to the subject |
| explanation | existing `DOC_RATIONALE` |
| procedure | process/mechanism language for the asked how |
| quantity | a number, count word, rate, or currency **about the subject** |
| identifier | the asked identifier type (digit run for phone/SSN; key-shaped token). A name list fails |
| enumeration | see §14 |
| failure | failure lexicon **and** the asked subject (passwords, not VM traces) |
| absence | keep hard silence |

A supported sentence that fails compatibility is rejected. Support stays last.

---

## 14. EnumerationContract

One-sentence extract is the wrong tool for “what are the three…”, “which models…”, “what isolation levels…”.

```ts
type EnumerationContract = {
  askedCount?: number          // 2, 3, 5 when stated
  categoryTerms: string[]      // pillars, resources, steps, levels
  requireMembers: boolean
}
```

Admission:

- Prefer a **single page-local** mapped block that already contains the list (lead-in + members). `listingClaim` in `document-card.ts` is the seed — keep it page-local, never stitch pages.
- If `askedCount` is N, the block must establish N members or silence.
- A category header (“the steps are as follows:”, “CISA’s five pillars:”) without members → reject (`btc-steps`, `omb-pillars`).
- Do not compose a list from unrelated chunks.

`cisa-parts` is source-selector first; once scoped to CISA, the same enumeration rule applies.

---

## 15. Candidate-admission sequence

Chosen order, from the existing `localCard` → `documentCard` loop:

```text
retrieve (weights FROZEN)
    ↓
build QuestionContract          // new, from question + Context identity + thread
    ↓
if sourceSelector unresolved/ambiguous/empty-typed → SILENCE
    ↓
filter hits to resolved sourceId when present
    ↓
walk remaining hits in retrieve order   // keep first-speaker, but each hit must pass:
    source-selector match
    required subject terms in the *claim* (do not drop df=0)
    predicate/relation
    answer-expectation (+ enumeration)
    existing shape (who/why/where/absence/failure, tightened)
    extract exact claim
    sayable / not smashed            // H
    DocumentEvidence map
    currentness
    support                         // LAST, unchanged
    ↓
first fully admitted speaker wins
else SILENCE
```

Why this order:

1. Source filter is cheapest and prevents the entire 20-case “wrong PDF” class from reaching extract.
2. Subject/predicate/expectation run on the **extracted claim**, not the chunk, so a gold chunk can still be rejected for a wrong sentence (A-extract).
3. Shape stays, because `absence` / `who` / `why` already work when they fire.
4. Evidence remains last-line safety. Question compatibility never weakens it.

Abstention bias is explicit: any failed contract step is silence. Target is **wrong-intent → 0%**, even if answerable hit falls below 16%. Coverage is 4A.10.

Do not weaken `verifyClaim`. Do not add embeddings. Do not retune IDF / retrieve weights / `MAX_PER_FILE`.

---

## 16. Abstention strategy

Next goal is not coverage.

- Prefer silence whenever a required subject, predicate, source, or answer-type is missing.
- Dropping unknown terms is forbidden for required contract fields.
- Ambiguous source → silence.
- Smashed extract → silence (do not speak a supported fragment).
- Accept a temporary hit rate below 16%. Recover later with 4A.9 (readable gold pages) and only then 4A.10 (hybrid retrieval).

The 8 I-eval-span cases should remain speakable; they are not the thing to silence. The eval harness span matcher is a later hygiene item, not a label change.

---

## 17. Parser / layout failure analysis (4A.9 track — no fix here)

From frozen `card-run.json` corpus + re-parse (same pipeline, uncapped chunks):

| PDF | pages | 1-col | 2-col | uncertain | full | isolated | skipped | chunks | avg/page | max/page | >200 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| attention.pdf | 15 | 6 | **0** | 9 | 6 | 3 | 6 | 158 | 17.6 | 35 | no |
| bert.pdf | 16 | 0 | **0** | 16 | 0 | 14 | 2 | 781 | 55.8 | 64 | **yes** |
| bitcoin.pdf | 9 | 7 | 0 | 2 | 7 | 1 | 1 | 118 | 14.8 | 28 | no |
| cisa-ransomware.pdf | 31 | 1 | 0 | 30 | 1 | 30 | 0 | 945 | 30.5 | 54 | **yes** |
| cs229-notes.pdf | 28 | 0 | 0 | 28 | 0 | 1 | **27** | 27 | 27 | 27 | no |
| lora.pdf | 26 | 9 | 0 | 17 | 9 | 2 | 15 | 353 | 32.1 | 75 | **yes** |
| nist-800-145.pdf | 7 | 1 | 1 | 5 | 2 | 5 | 0 | 129 | 18.4 | 42 | no |
| nist-800-207.pdf | 59 | 28 | 5 | 26 | 33 | 26 | 0 | 1154 | 19.6 | 42 | **yes** |
| nist-800-63b.pdf | 80 | 4 | 5 | 71 | 9 | 70 | 1 | 2080 | 26.3 | 39 | **yes** |
| omb-m22-09.pdf | 29 | 13 | 3 | 13 | 16 | 13 | 0 | 578 | 19.9 | 37 | **yes** |
| resnet.pdf | 12 | 0 | **0** | 12 | 0 | 10 | 2 | 567 | 56.7 | 77 | **yes** |
| tracemonkey.pdf | 14 | 1 | 0 | 13 | 1 | 12 | 1 | 726 | 55.8 | 71 | **yes** |

Uncapped ready chunks: **7616**. Production ingest refuses `>200` chunks/PDF and `>800` document chunks/Context. Eight real PDFs would be refused at ingest. Do **not** raise those caps.

Also refused / unreadable (no chunks): `rfc9110` (pages), `nist-800-12` (pages), `irs-p15` (chars), `scanned` (scanned), `encrypted*` (unreadable).

Two-column miss: Attention, BERT, ResNet are genuine two-column and recorded **0** `two-column` pages.

`detectReadingOrder` (`layout.ts`):

- `twoColumnPair` requires **exactly two** substantial left-edge clusters. IEEE/NIPS pages have 3+ (columns plus captions, equations, page numbers) → pair is `null`.
- Mid-gutter fallback marks `uncertain` when left-edge spread `> 0.35 * pageWidth`.
- `isConfidentTwoColumn` then never runs.

`normalize.ts`: `uncertain` → `isolated-lines` (or `skipped` if no usable line). CS229 math pages have items but fail `lineIsUsable` / look like a dense grid → **27/28 skipped**, 2035 extracted characters. Lecture questions then retrieve other PDFs.

That is a **4A.9** problem. Mixing it into 4A.8.1 would hide relevance bugs behind newly readable pages.

---

## 18. Chunk explosion

Cause, in order:

1. **Uncertain-layout overclassification** — real two-column and government multi-block pages become `uncertain`.
2. **Isolated-line fallback** — every newline-delimited visual line that passes `isolatedLineEligible` (≥4 letter-words, or 3 + punctuation) becomes its **own chunk**. BERT/ResNet/TraceMonkey average ~56 chunks/indexed page (max 64–77).
3. **No paragraph reconstruction** on isolated-lines. `pageBlocks` splits on `\n` and never merges.
4. **PDF.js item fragmentation** — words arrive as separate items; visual-line grouping plus per-line newlines multiplies blocks.
5. **Headers / footers / running titles** — “This publication is available free of charge…” is eligible and repeats, adding chunks and false retrieve hits (visible in several 800-207 winning chunks).
6. **Paragraph model on `full` pages is not the explosion.** Bitcoin (mostly single-column full) is 118 chunks / 9 pages. The explosion tracks isolated-lines.

4A.9 should reconstruct paragraphs on recovered two-column pages and stop treating uncertain as one-chunk-per-line. Caps stay at 200 / 800 until the structural reason is fixed.

---

## 19. Proposed regression cases

See `regression-set.json`. Minimum set and required assertion:

| class | case | assert |
|---|---|---|
| explicit wrong-document | `un-lora-salary`, `un-scan-text`, `un-enc-secret` | SILENCE |
| explicit source, gold available | `cisa-what` | CISA guide, not ZTA |
| lexically tempting unanswerable | `un-growth`, `un-figure-secret` | SILENCE |
| wrong predicate | `un-hybrid-sla`, `cisa-backups`, `lora-what` | SILENCE or gold extract |
| wrong answer type | `un-bert-phone`, `un-zta-price`, `bert-glue` | SILENCE or real quantity |
| list/enumeration | `cisa-parts`, `omb-pillars`, `btc-steps` | real list or SILENCE |
| who/ownership | `un-who-owns-btc`, `un-who-owns-zta` | SILENCE (already silent — keep) |
| where/location | `un-personal`, `un-customer-pii-attn` | SILENCE |
| why/rationale | `un-why-pay` | SILENCE |
| shared-vocab cross-doc | `63b-aal3`, `btc-header` | gold (was Top-1) or SILENCE |
| thread document | `cs229-followup-gd`, `cs229-normal` | SILENCE until lecture pages exist |

Do not implement these tests against a “fixed” composer in this turn.

---

## 20. Recommended implementation sequence

### PHASE 4A.8.1 — QuestionContract / source-selector / relation admission

Ship the contract, source eligibility, required-term (do-not-drop), predicate, answer-expectation, enumeration, smashed-extract silence. Evidence gate unchanged. Weights frozen. Goal: **wrong-intent → 0% on this development corpus**, accept hit rate < 16%.

Do not use 4A.7 as the ship gate after tuning.

### PHASE 4A.9 — Real-world PDF layout + chunk architecture

- Two-column detection that survives captions/equations (not “exactly two clusters”).
- CS229-class math pages: skip vs isolated vs reconstruct — decide with dumps, not by raising caps.
- Isolated-line → paragraph reconstruction.
- Repeated running-header suppression already exists; verify it on 800-x.
- Then, and only then, revisit 200 / 800 if well-formed chunks still overflow.

### PHASE 4A.10 — Coverage / hybrid retrieval

Only if, after 4A.8.1 + 4A.9, gold pages are readable and still lose in Top-6. Not the next safety fix. Still no embeddings-as-admission.

### PHASE 4A.11 — New blind release gate

New third-party corpus, labeled from dumps before Cards, never seen during 4A.8–4A.10. Same metrics. Landing stays Coming soon until that gate passes.

---

## Decision (unchanged)

KEEP PDF COMING SOON.

Do not begin DOCX/PPTX/XLSX. Do not add embeddings. Do not tune retrieval. Do not modify PDF parsing in 4A.8.1 except inasmuch as smashed-extract *admission* silence is a relevance gate, not a parser change.
