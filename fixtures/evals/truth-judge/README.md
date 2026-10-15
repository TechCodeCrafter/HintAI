# Truth judge offline eval fixtures

**Experimental only** — synthetic labelled cases for `npm run eval:truth-judge`.

- No customer or private beta data
- Ground-truth labels are hand-authored in `scripts/build-truth-judge-fixtures.mjs`
- Regenerate: `node scripts/build-truth-judge-fixtures.mjs`

| File | Cases |
|------|-------|
| `question-classification.json` | ~40 |
| `evidence-applicability.json` | ~80 |
| `escalation.json` | ~80 |

Categories covered include: correct source, wrong source, test vs implementation, route docs vs worker, partial support, negation, numeric drift, version mismatch, irrelevant similarity, unsupported questions, and multi-source scenarios.
