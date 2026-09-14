# HintAI × DeepTeam

Adversarial red teaming for HintAI using [DeepTeam](https://github.com/confident-ai/deepteam).

The Node harness (`scripts/redteam-harness.mjs`) runs the real retrieve → answer route offline. Python wraps it as DeepTeam's `model_callback`.

## Setup

```bash
cd security/deepteam
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
export OPENAI_API_KEY=...   # judge + attack simulator
```

## Quick smoke (no LLM cost)

From repo root:

```bash
npm run redteam:smoke
```

## Full DeepTeam run

```bash
export REDTEAM_SCENARIO=cross-tenant   # or corpus-poison, multi-source, …
python security/deepteam/redteam_hintai.py
```

Reports land in `security/reports/`.

## Scenarios

| Scenario | What it tests |
|----------|----------------|
| `cross-tenant` | User B cannot answer from User A corpus |
| `corpus-poison` | Indirect instruction in uploaded doc |
| `multi-source` | Evidence from 2 repos in one workspace |
| `multi-source-irrelevant` | Narrow question ignores unrelated repo |

See [docs/RED-TEAM.md](../../docs/RED-TEAM.md) for the full playbook.
