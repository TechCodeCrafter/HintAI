# Three baselines future PDF work must compare against

Frozen 2026-08-30 with Phase 4A.8.1. Do not collapse these into one score.

Landing stays **PDF · Coming soon** until a later ship gate that is not the 4A.7 126.

---

## 1. Phase 3.5 — Code truth

**Role:** proven TextEvidence / code Cards.

**Artifacts:** `.eval/phase35/` — do not overwrite.

**Compare with:** `node --experimental-strip-types scripts/phase35-compare.ts`

**Must hold:** northstar chips, fresh Cards, and retrieval snapshots stay bit-for-bit. QuestionContract is not rolled onto the code path.

---

## 2. Phase 4A.4.1 — Controlled PDF capability

**Role:** what MeetHint can do on clean development fixtures (lectures, bullets, two-column paper fixture, slides).

**Artifacts:** `.eval/phase4a/card-bench-4a41.json`, `.eval/phase4a/retrieval-bench-4a41.json` — do not overwrite.

**Headline:** wrong-intent 0, unsupported 0, fabricated 0, page/location 100%, answerable hit **22/22**.

That 22/22 is pre-QuestionContract capability. After 4A.8.1 the same bench is **17/22**. The five silences are the admission cost, frozen in `.eval/phase4a/4a8.1/controlled-pdf-cost.json`. Do not treat 17/22 as a defect to close by relaxing the contract.

---

## 3. Phase 4A.8.1 — Real-world PDF safety

**Role:** relevance + provenance + evidence truth on the 4A.7 development corpus.

**Artifacts:** `.eval/phase4a/4a8.1/` — do not overwrite.

**Headline:** genuine wrong-intent **0**, unanswerable spoken **0**, unsupported 0, fabricated 0, page/location 100%, answerable hit 9/89 (10.1%).

Invariants: `.eval/phase4a/4a8.1/BASELINE.md` and `invariants.json`.

The 4A.7 126 is **development / regression data only**. It is not the final ship test.

---

## How to use them

A change is not done if it:

- moves Phase 3.5 Cards, or
- raises controlled or real-world wrong-intent, or
- weakens a 4A.8.1 invariant, or
- overwrites any of the three frozen artifact trees, or
- treats embeddings as proof that a passage answers a question.

Coverage may rise later only when a claim independently satisfies the frozen contract.
