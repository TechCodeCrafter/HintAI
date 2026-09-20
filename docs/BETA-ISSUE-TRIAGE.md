# Beta Issue Triage (#115 Wave 1)

Use this rubric when logging tester reports or issues you find during Wave 1. **Do not expand scope** — triage, fix blockers, defer the rest until after the observation window.

## Severity levels

### BLOCKER

Product unusable or trust-breaking. Fix before inviting more testers.

**Examples:**

- Cannot sign in or session drops on every navigation
- User sees another account’s Knowledge Spaces, sources, or answers
- Data loss: indexed sources, spaces, or settings disappear after refresh or browser restart
- Cannot create a Knowledge Space or connect any source
- App crash loop or blank screen on core paths (`/`, `/create`, `/context/...`)

**Response:** Same-day owner assignment. Pause new invites until resolved or mitigated.

---

### HIGH

Core value broken or dangerously wrong.

**Examples:**

- **Wrong confident answer** — supported/cited answer that is clearly false for the connected sources
- **Live broken** — mic/capture fails persistently, Live never produces answers, or Live stops mid-meeting without recovery
- **Broken persistence** — answers/history/spaces missing intermittently (not full data loss)
- Indexing stuck forever with no actionable error
- Search always silent when sources clearly contain the answer

**Response:** Fix within the observation window if possible; document workaround for testers.

---

### MEDIUM

Usable but confusing, incomplete, or eroding trust slowly.

**Examples:**

- Confusing UX — unclear next step after signup, indexing, or first question
- Citation issue — link opens wrong file, snippet mismatch, or hard to verify
- Indexing friction — slow, opaque progress, or unclear what was indexed
- Missing “where are my documents?” — tester cannot find uploaded/indexed files in one obvious place
- Modal/layout issues that don’t block the main flow
- Negative feedback categories don’t match the problem

**Response:** Log, prioritize after Wave 1; optional copy or micro-fix only if zero risk.

---

### LOW

Polish, copy, minor visual issues.

**Examples:**

- Typos, awkward labels, inconsistent spacing
- Non-blocking animation or theme glitches
- Nice-to-have shortcuts or empty states

**Response:** Backlog; no Wave 1 engineering unless trivial.

---

## Issue log (Wave 1)

| ID | Date | Severity | Tester | Summary | Status | Owner |
|----|------|----------|--------|---------|--------|-------|
| _W1-001_ | | | | | open | |

## Triage workflow

1. Reproduce or verify with tester diagnostic export.
2. Assign severity using definitions above (when in doubt, round **up** for trust/data issues).
3. BLOCKER/HIGH → link GitHub issue and notify wave owner.
4. MEDIUM/LOW → add to backlog; reference in [archive/BETA-WAVE-1.md](./archive/BETA-WAVE-1.md) tester **Notes**.
5. After 3–5 days, review open HIGH items before Wave 2 (#116).

## Related

- [archive/BETA-WAVE-1.md](./archive/BETA-WAVE-1.md) — scorecard and go/no-go
- [BETA-MILESTONE-REPORT.md](./BETA-MILESTONE-REPORT.md) — telemetry and diagnostics
