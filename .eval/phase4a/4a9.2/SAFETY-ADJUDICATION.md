# Phase 4A.9.2.1 — Safety adjudication (relevance only)

**Status:** 4A.9.2 must **not** be frozen. Phase 4A.9.3 was **not** started.

No production file was changed. Frozen labels were not edited. Parser, normalizer, structure, prose regions, math/grid classifier, chunker, retrieval, viewer, and citations are untouched. Existing 4A.9.2 outputs were not overwritten.

The invariant under test is **question–evidence relevance**, not correct source, exact provenance, or word support.

---

## Decision

| Gate | Result |
|---|---|
| Newly spoken Cards after 4A.9.2 | **4** |
| Exact-gold acceptable | **1** (`resnet-degrade`) |
| `ACCEPTABLE_ALT_SPAN` | **0** |
| `PARTIAL_BUT_VALID` | **1** (`bert-nsp`) |
| Genuine relevance wrong-intent | **2** (`lora-what`, `tm-base`) |
| **May 4A.9.2 be frozen?** | **No** |

`lora-what` is a genuine subject-scope failure: truthful LoRA-paper text about an experimental ablation, admitted as the method-level answer to “What does LoRA freeze?”

`tm-base` is a genuine relation / answer-type failure: truthful TraceMonkey-paper related-work text about inline threading, admitted as the named interpreter they implemented on.

Both passed frozen QuestionContract. Both were silence / `ADMISSION_FAILURE` in 4A.8.1. Representation change re-exposed them. That is a relevance safety hole. Freeze is blocked.

---

## 1. Newly spoken Cards (4A.8.1 → 4A.9.2)

4A.8.1 spoke 13 IDs. 4A.9.2 spoke 17. None of the 13 were lost.

| id | 4A.8.1 | 4A.9.2 | Human class | Blocks freeze? |
|---|---|---|---|---|
| `resnet-degrade` | silent (same retrieve pages; extract failed) | gold-span hit, page 1 | exact gold — acceptable | no |
| `bert-nsp` | silent, `C-predicate-relation` | same PDF/page as gold; setup sentence | `PARTIAL_BUT_VALID` | no |
| `lora-what` | silent, `C-predicate-relation` | lora.pdf p5 “freeze the MLP modules” | `WRONG_SUBJECT_INSTANCE` | **yes** |
| `tm-base` | silent, `C-predicate-relation` | tracemonkey.pdf p13 inline-threading / JIT | `WRONG_RELATION` | **yes** |

Kept speakers (already spoken in 4A.8.1; not re-adjudicated as new): `cisa-smb`, `attn-arch`, `resnet-what`, `btc-coin`, `btc-incentive`, `tm-what`, `tm-speedup`, `nist145-hybrid`, `zta-what`, `zta-asset`, `omb-when`, `omb-passwords`, `63b-aal1`.

`tm-what` changed from 4A.8.1 category-I leftover to a gold-span hit. It was already spoken. Not a new speaker.

---

## 2. `bert-nsp`

### Inspection

| Field | Value |
|---|---|
| User question | How is the next sentence task generated? |
| Expected human answer | 50% of the time B is the actual next sentence (and 50% a random sentence) |
| Frozen gold span | `50% of the time B is the actual next sentence` |
| Cited PDF / page | bert.pdf · **4** (same as gold) |
| Retrieval rank | **1** (`bert.pdf#4`) |
| 4A.8.1 retrieve | `bert.pdf#8` first — page 4 was not top-ranked |
| Spoken claim | `In order This step to train a model that understands sentence relationships, we pre-train for a binarized next sentence prediction task that can be trivially generated from any monolingual corpus.` |
| `DocumentEvidence.supportText` | same as spoken claim |
| Machine-strict span | miss (`intentWrong` true in the gate’s gold-span metric) |

**Complete retrieved chunk** (bert.pdf page 4):

> Task #2: Next Sentence Prediction (NSP) Many important downstream tasks such as Question Answering (QA) and Natural Language Inference (NLI) are based on understanding the relationship between two sentences, which is not directly captured by language modeling. In order This step to train a model that understands sentence relationships, we pre-train for a binarized next sentence prediction task that can be trivially generated from any monolingual corpus. Specifically, when choosing the sentencesAandBfor each pretraining example, 50% of the time B is the actual next sentence that follows A (labeled as IsNext), Unfortunately, and 50% of the time it is a random sentence from the corpus (labeled as NotNext). …

The gold 50% rule is **in the same chunk**, immediately after “Specifically”.

### QuestionContract (reconstructed, unchanged code)

| Field | Value |
|---|---|
| shape | `how` |
| required subject terms | `next`, `sentence`, `task`, `generated` |
| optional subject terms | *(none)* |
| sourceSelector | none (question does not name BERT) |
| predicate | `procedure` / signals `[]` |
| requiredVerb | none |
| answerExpectation | `procedure` |
| needsDefinitionCopula | false |

`generate` is an ask-verb; `generated` is not, so it stays required. That is why the preamble wins the extract score (4/4 terms) and the 50% sentence loses (`task` and `generated` absent → score 2).

### Admission checks that passed

1. `sourceHitEligible` — no selector, any source allowed; retrieved source is still the correct PDF.
2. Required terms `next`, `sentence`, `task`, `generated` all mention-match the preamble.
3. `predicateFits(procedure)` — always true.
4. `expectationFits(procedure)` — always true.
5. No `requiredVerb`, no enumeration, no copula, no when-predicative.
6. Currentness + word support of the spoken fragment — pass.

There is no check that a `how … generated` claim must be the generation **rule** rather than “this task can be generated from a corpus.”

### Human relevance

The spoken Card is about NSP generation, on the correct page, in the correct section. It correctly says the binarized NSP task can be produced from any monolingual corpus. It does **not** give the pairing rule the frozen label (and the 4A.8 gate) treat as the answer.

4A.8 reviewed gate (frozen, not edited): `HOW generated (50% next / 50% random) ≠ the task name alone.`

The new sentence is more than the task name, and less than the 50/50 rule. Classification: **`PARTIAL_BUT_VALID`**.

Not wrong-intent. Not freeze-blocking on its own.

Smashed leftover `In order This step` is a two-column residue (`This step is presented…` joined into `In order to train…`). Quality defect, not a different question.

---

## 3. `lora-what` — highest-risk case

### Inspection

| Field | Value |
|---|---|
| User question | What does LoRA freeze? |
| Expected human answer | pretrained model weights |
| Frozen gold span | `freezes the pre- trained model weights` |
| Gold location | lora.pdf · **page 1** (abstract / method) |
| Cited PDF / page | lora.pdf · **page 5** |
| Retrieval ranks | 1 = `lora.pdf#2` (`We can freeze the shared model…`); 2 = `lora.pdf#5` (spoken) |
| 4A.8.1 retrieve | already `lora.pdf#5` then `#2` — admission failed |
| Spoken claim | `Tasks and freeze the MLP modules (so they are not trained in downstream tasks) both for simplicity` |
| `supportText` | `tasks and freeze the MLP modules (so they are not trained in downstream tasks) both for simplicity` |
| Machine-strict span | miss |

**Complete retrieved (winning) chunk** — the entire chunk is 98 characters:

> tasks and freeze the MLP modules (so they are not trained in downstream tasks) both for simplicity

Rank 1 (`We can freeze the shared model and efficiently switch tasks`) is rejected by the existing modal rule (`can freeze`). Rank 2 is the fragment that spoke.

### Source passage (dump, page 5, §4.2 Applying LoRA to Transformer)

> In principle, we can apply LoRA to any subset of weight matrices in a neural network… We **limit our study** to only adapting the attention weights for downstream **tasks and freeze the MLP modules** (so they are not trained in downstream tasks) **both for simplicity and parameter-efficiency**. We further study the effect on adapting different types of attention weight matrices… We leave the empirical investigation of adapting the MLP layers…

Method-level sentence on page 1 (gold):

> We propose Low-Rank Adaptation, or LoRA, which **freezes the pre-trained model weights** and injects trainable rank decomposition matrices…

### What is grammatically frozen

- **Object of freeze in the claim:** `the MLP modules`.
- **Not** pretrained model weights.
- **Passage type:** experimental / study limitation inside “Applying LoRA to Transformer.” They freeze MLPs **in this study** for simplicity, and explicitly leave adapting MLP layers to later work.
- **Not** the LoRA method definition. **Not** a baseline. **An ablation / configuration choice.**

Correct source + verb `freeze` is not sufficient. This is the case the user flagged.

### QuestionContract

| Field | Value |
|---|---|
| shape | `what` |
| required subject terms | `freeze` |
| optional subject terms | `lora`, `freeze` |
| sourceSelector | named `lora` → `lora.pdf` (`filename`, not ambiguous) |
| predicate | `definition` / signals `[]` |
| requiredVerb | `freeze` |
| answerExpectation | `definition` |
| needsDefinitionCopula | false (`what does` is excluded) |

`lora` is a source-selector token, so it is **optional in the claim**. After ask-verbs empty the required list, the fallback puts `freeze` back as the only required subject. The claim never has to mention LoRA, weights, or the method.

### Admission checks that passed (on the **extracted** lowercase fragment)

The extract is the chunk itself: `tasks and freeze the MLP modules…`.

1. `sourceHitEligible(lora.pdf)` — pass.
2. `brokenSpokenEdge` — pass. Lowercase `tasks and freeze` does not match the smashed-capital `Tasks and …` rule. (`sayable` later capitalizes to `Tasks and freeze…`; admission does not re-check that form.)
3. Required term `freeze` mention-matches.
4. `predicateFits(definition)` — always true.
5. `expectationFits(definition)` — always true.
6. `requiredVerb=freeze`: stem `freez` present; not `can/may/might/could freeze`; `firstActionVerb` = `freeze` because the fragment **starts after** `limit`.
7. Currentness + word support — pass.

### Why the frozen contract was supposed to reject this

`question-contract.test.ts` already encodes the full ablation sentence as **inadmissible**:

```
"We limit our study to only adapting the attention weights and freeze the MLP modules."
→ claimFitsContract === false   (first action verb is limit)
"LoRA freezes the pre-trained model weights."
→ true
```

4A.8 reviewed gate (frozen): `freeze target is pre-trained weights, not MLP modules in the ablation.`

4A.8.1 retrieved page 5 as a **larger** chunk. The full sentence’s first action is `limit`, so admission stayed closed. 4A.9.2 isolated the conjunctive tail as its own chunk. `firstActionVerb` became `freeze`. The same ablation was admitted.

### Classification

**`WRONG_SUBJECT_INSTANCE`** — genuine wrong-intent.

Requested subject (LoRA’s freeze behavior) is correct at a broad “this paper talks about freezing” level. The claim describes a **different component in an ablation/configuration**, not the method.

Provenance is perfect. Support is perfect. Relevance fails.

---

## 4. `tm-base`

### Inspection

| Field | Value |
|---|---|
| User question | Which interpreter did they implement on? |
| Expected human answer | SpiderMonkey |
| Frozen gold span | `existing JavaScript interpreter, SpiderMonkey` |
| Gold location | tracemonkey.pdf · **page 2** |
| Cited PDF / page | tracemonkey.pdf · **page 13** |
| Retrieval rank | **1** (`tracemonkey.pdf#13`) |
| 4A.8.1 retrieve | page 13 **absent**; first hits were bitcoin / OMB / tracemonkey#3 |
| Spoken claim | `Inline threading (15) copies chunks of interpreter native code which implement the required bytecodes into a native code cache, thus acting as a simple per-method JIT compiler that eliminates the dispatch overhead.` |
| `supportText` | same as spoken claim |
| Machine-strict span | miss |

**Complete retrieved chunk** (page 13, related-work / comparison):

> … Call threading, also known as context threading (8), compiles methods by generating a native call instruction to an interpreter method for each interpreter bytecode. … Inline threading (15) copies chunks of interpreter native code which implement the required bytecodes into a native code cache, thus acting as a simple per-method JIT compiler that eliminates the dispatch overhead. Neither call threading nor inline threading perform type specialization. Apple’s SquirrelFish Extreme (5) is a JavaScript implementation based on call threading with selective inline threading. … Google’s V8 is a JavaScript implementation primarily based on inline threading…

The chunk is about **SFX and V8** as alternative JS implementations. It does not name SpiderMonkey as the host they implemented on. Gold page 2 (`existing JavaScript interpreter, SpiderMonkey`) was not retrieved.

### What “implement” attaches to

- Grammatical subject of `implement`: `interpreter native code` (“chunks of interpreter native code **which implement** the required bytecodes”).
- **Not** “they implemented on interpreter X.”
- Passage type: related-work definition of inline threading, then comparison to SFX / V8.
- **Not** the TraceMonkey implementation-host sentence.

### QuestionContract

| Field | Value |
|---|---|
| shape | `what` |
| required subject terms | `interpreter` |
| optional subject terms | `implement` |
| sourceSelector | none (question does not say TraceMonkey) |
| predicate | `definition` / signals `[]` |
| requiredVerb | `implement` (`which … did they implement`) |
| answerExpectation | `definition` — **not** `naming` |
| needsDefinitionCopula | false |

`which interpreter` does not set a naming / entity expectation. `answerExpectation=definition` is a no-op.

### Admission checks that passed

1. No source selector → page 13 of the correct PDF is eligible.
2. Required term `interpreter` mention-matches.
3. Definition predicate / expectation — always true.
4. `requiredVerb=implement`: the relative clause `which implement the required bytecodes` satisfies the stem. `firstActionVerb` is also `implement` because **`copies` is not in `ACTION_VERB`**, so the relative-clause verb wins.
5. Currentness + word support — pass.

The frozen test only rejects a *different* near-miss (`The LIR also encodes all the stores that the interpreter would do…`) because its first action is `encodes`. It does not require a named interpreter, and it does not require `implement` to mean “implemented on.”

4A.8 reviewed gate (frozen): `which interpreter = SpiderMonkey, not LIR stores the interpreter would do.`

### Classification

**`WRONG_RELATION`** — genuine wrong-intent.

Truthful evidence from the correct PDF. It answers “what is inline threading?” (and sits next to SFX/V8), not “which interpreter did they implement on?”

A generic interpreter/JIT sentence fails the naming/entity expectation of `Which interpreter…?`. `WRONG_ANSWER_TYPE` is the runner-up; the primary failure is the relation (`implement-on` vs `code-which-implements-bytecodes`).

---

## 5. `resnet-degrade` (new speaker, not one of the three misses)

| Field | Value |
|---|---|
| Question | Is the degradation from overfitting? |
| Gold | `such degradation is not caused by overfitting` |
| Spoken | `Unexpectedly, such degradation is not caused by overfitting , and adding more layers…` |
| Cited | resnet.pdf · page 1 (gold page) |
| Rank | 1 |
| `matchedSpan` | **true** |

4A.8.1 already retrieved `resnet.pdf#1` and stayed silent (`Nothing in this pack cites that`) — the gold sentence was buried in a larger smashed page-1 chunk. 4A.9.2 isolated that sentence. It is the frozen human answer.

Class: exact gold, acceptable. Not an alternate span. Not wrong-intent.

---

## 6. Counts

| | Count | IDs |
|---|---:|---|
| Newly spoken | **4** | `resnet-degrade`, `bert-nsp`, `lora-what`, `tm-base` |
| Acceptable (exact gold) | **1** | `resnet-degrade` |
| `ACCEPTABLE_ALT_SPAN` | **0** | — |
| `PARTIAL_BUT_VALID` | **1** | `bert-nsp` |
| Genuine wrong-intent | **2** | `lora-what` (`WRONG_SUBJECT_INSTANCE`), `tm-base` (`WRONG_RELATION`) |

Unanswerable spoken, unsupported, fabricated, and wrong-source remain 0. Those floors are not the issue. Relevance is.

---

## 7. Why QuestionContract admitted the two failures

### Shared hole

For both blockers:

- `predicate=definition` and `answerExpectation=definition` are **pass-throughs**.
- The asked relation is approximated by **string presence of a verb**, not by who does what to whom, in what experimental frame.
- The named method/system does not have to appear **in the claim** once it has been used as a file selector (`lora`) or is absent from the question (`tm-base`).

That is the frozen invariant “predicate / answer-type compatibility is required” implemented too weakly for these two shapes.

### `lora-what` — missing condition

**Missing concept:** subject scope + local contextual qualifier.

Needed, in one line: the object of `freeze` must be the **method-level** freeze target, not a component frozen inside “we limit our study / for simplicity.”

Smallest deterministic candidates (not implemented):

1. **Keep `firstActionVerb` honest across chunk splits.** The full ablation sentence already fails. The hole is an isolated conjunctive tail. Tightening `brokenSpokenEdge` to reject `… and <requiredVerb>` fragments that have no clause-level subject would close this exact chunk. Closest to “do not admit a smashed conjunct.”
2. **When `requiredVerb` is set, keep the named source token required in the claim** (`LoRA`), not only as `sourceSelector`. This fragment never says LoRA. Gold does.
3. **Object-scope / ablation cue** (`limit our study`, `for simplicity`, `leave the empirical investigation`) — more semantic, still closed-class.

(1) and (2) are deterministic. They implement the **already frozen** unit test, which 4A.8.1 satisfied and 4A.9.2 representation violated.

**4A.8.1 impact:** `lora-what` was silent. A tighter edge/subject rule would restore that silence. Existing 4A.8.1 speakers do not use this fragment. Controlled 17/22 should stay 17/22 if the gold LoRA sentence still mentions LoRA + freeze. Do not loosen anything else to compensate.

### `tm-base` — missing condition

**Missing concept:** answer type (named interpreter) + relation scope (`implement on` vs relative-clause `implement`).

Needed, in one line: `Which <entity> did they implement on?` requires a **named instance of that entity**, and `implement` must be the main-clause relation, not “code which implement bytecodes.”

Smallest deterministic candidates (not implemented):

1. **`which <noun> did they <verb>` → `answerExpectation=naming`** (or a required proper-name / `called|named|existing …, <Name>` signal). Generic interpreter/JIT prose would fail.
2. **`requiredVerb` must be the main-clause verb.** Put `copies` (and similar) in the action list, or ignore relative-clause `which <verb>`. Then this sentence’s first action is `copies`, not `implement`, and it fails the existing first-action rule — same pattern as the frozen LIR/`encodes` test.

(2) is the smaller patch and matches an existing test doctrine. (1) is the missing answer-type the 4A.8 gate named.

**4A.8.1 impact:** `tm-base` was silent (page 13 was not even retrieved). Closing admission would restore silence on this related-work sentence. No 4A.8.1 spoken Card uses `requiredVerb=implement`. Naming-on-`which` must be checked against other `which` questions before implementation; do not implement here.

---

## 8. Safety decision

Phase 4A.9.2 **may not be frozen.**

Genuine relevance wrong-intent after human adjudication of every newly surfaced Card = **2**, not 0.

Do **not** begin Phase 4A.9.3.

Do **not** implement the contract fix in this phase. The layout work stays intact. The next explicit ask should be the smallest QuestionContract patch for subject-scope / main-clause verb (and only then a re-gate), not block reconstruction.

Machine copy: `safety-adjudication.json`.
