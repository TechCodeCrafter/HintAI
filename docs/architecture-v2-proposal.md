# MeetHint Architecture v2: Grounded-first with labeled general knowledge

**Status:** proposal · **Date:** 2026-10-06 · **Author:** Muse (for Praj)

## 1. The contract change

| | v1 (current) | v2 (proposed) |
|---|---|---|
| Files cover it | Cited answer | Cited answer (unchanged) |
| Files don't cover it | Silence + reason | **Labeled general-knowledge answer** |
| Nothing can answer | Silence + reason | Silence + reason (unchanged) |

The v1 contract — "cite or silence" — is principled but leaves users hanging mid-meeting. v2 keeps every trust property of v1 and adds exactly one new path: when the grounded pipeline returns INSUFFICIENT, a fallback composer answers from general knowledge, **visibly badged**, never cited, never blended.

## 2. Why this, why now

In a live call, "your material doesn't cover this" is honest but useless — the user still has to answer the room. A clearly-labeled LLM answer is the helpful move, and the label is what keeps it honest. Every mainstream meeting copilot does RAG-then-LLM; none of them label the seam. The seam is the differentiator.

## 3. Trust invariants (non-negotiable)

1. **A cited claim is always verified.** `verifyClaim` doesn't change. Nothing about the fallback softens the grounded path.
2. **General answers never carry citations.** No file:line references, no `[1]` markers, no provenance labels.
3. **Never blend.** One card is either grounded or general. A general answer must not quote file content; a grounded answer must not include uncited model claims.
4. **The mode is structural, not cosmetic.** `AnswerResult.mode: "grounded" | "general" | "silent"` drives rendering, quota, and telemetry — not a CSS class someone can forget.
5. **Fallback is measurable.** Log mode on every card so we can track fallback rate; a rising fallback rate means the corpus (not the model) needs work.

## 4. Pipeline

```
spoken question
  → hybrid retrieve (unchanged; concept-aware matching from #88 when merged)
  → generateAnswer      grounded: cited + verifyClaim, or INSUFFICIENT
  → synthesizeAnswer    cited synthesis only — uncited output discarded
  → localCard           offline exact extraction (free, always cited)
  → ★ generalKnowledge  NEW: runs ONLY on INSUFFICIENT from all grounded paths
  → silence             specific reason — model unavailable, transport failed
```

### The fallback composer (`general-answer.ts`, new module)

- **Input:** the question (+ thread history), and explicitly *not* the retrieved chunks — feeding chunks invites the model to launder file content into an "uncited" answer.
- **Prompt contract:** "Answer from general knowledge. State uncertainty plainly. Never invent file names, paths, line numbers, or citations. Never claim the answer comes from the user's material."
- **Output contract:** `{ mode: "general", say, caveats }` — no `citations`, no `evidence`. The type system should make it impossible to attach evidence to a general answer.
- **Guardrail:** a post-check scans the output for citation-shaped text (`[1]`, `file:`, `line \d+`, `.ts:`) and strips or rejects it. Belt and suspenders.

## 5. UI

- **Badge:** "General knowledge" pill on the card, distinct from the grounded "Verified · file:line" treatment. Muted/amber tone vs. the grounded accent.
- **Card body:** the answer, plus a one-line disclaimer on first use per session ("Not from your files").
- **Copy:** grounded cards keep "SAY THIS"; general cards use "SUGGESTED" — the verb matters.
- **Settings:** a "Strict mode" toggle (default off) that restores pure cite-or-silence for users who want it. One toggle, respected by `answer-route.ts`.

## 6. Data model changes

```ts
type AnswerMode = "grounded" | "general" | "silent";

interface AnswerResult {
  ok: boolean;
  mode: AnswerMode;          // NEW — was implicit
  say: string;
  citations?: Citation[];    // only when mode === "grounded"
  evidence?: Evidence[];     // only when mode === "grounded"
  reason?: SilenceReason;    // only when mode === "silent"
}
```

`answer-route.ts` becomes a mode router: grounded paths first, fallback on INSUFFICIENT, silence on hard failure. Quota counts model-backed answers regardless of mode (a general answer costs a model call too).

## 7. Implementation plan (step by step)

1. **Types:** add `AnswerMode` to the answer types; make `citations`/`evidence` mode-conditional. Typecheck must fail if a general answer carries evidence.
2. **Fallback composer:** new `general-answer.ts` with the prompt contract + citation-shape post-check. Unit tests: never emits citations, never references files, degrades gracefully on transport error.
3. **Route:** insert the fallback step in `answer-route.ts` between `localCard` and silence. Silence reasons: "uncovered" now routes to fallback; silence keeps transport/quota failures.
4. **UI:** badge + "SUGGESTED" copy + first-use disclaimer + Strict-mode toggle in settings.
5. **Telemetry:** log `mode` per card; dashboard the fallback rate.
6. **Tests:** never-blend property tests (fuzz grounded/general outputs through the renderer, assert no citation leaks either direction), fallback prompt tests, strict-mode tests.
7. **Docs:** README already updated; ARCHITECTURE.md § answer-pipeline gets the v2 diagram.

## 8. Open questions

- **Default:** fallback on or strict by default? Proposal: fallback on (helpfulness wins for a meeting copilot), Strict toggle for the purists.
- **Model:** same model as synthesis, or a cheaper/faster one for fallback? Latency matters mid-meeting — worth measuring.
- **Quota:** do general answers consume the same 20/day free budget? Proposal: yes (they cost model calls), stated plainly in Tiers.
- **Thread context:** should follow-ups in general mode stay general, or re-attempt grounded first? Proposal: re-attempt grounded on every new question; mode is per-answer, not per-thread.

## 9. What this doesn't change

Retrieval, `verifyClaim`, the evidence model, the subject/shape gates, the offline `localCard`, listening, and storage all stay as-is. v2 is a new terminal branch on the pipeline, not a rewrite.
