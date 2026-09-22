# MeetHint Beta — Structured Testing Session

**Version:** Wave 1 · September 2026  
**Product URL:** https://www.meethint.ai  
**Sign-up:** **Sign in with Google** — no invite code required  
**Estimated time:** **2–2.5 hours** (core session) + optional **Day 1 return**

This is a **professional, guided test session** — not a casual try-out. Register with Google, follow every phase, rate your experience, and return your completed checklist plus a diagnostics export. **Your feedback directly shapes what we ship.**

**Printable branded guide:** [MeetHint-Beta-Testing-Session.pdf](./MeetHint-Beta-Testing-Session.pdf) · source [beta-testing-session.html](./beta-testing-session.html)

---

## Get started (Google sign-up)

1. Go to [meethint.ai](https://www.meethint.ai) → **Sign in with Google** (use the account you will keep for this test).
2. Complete registration — **no separate invite code**; your account is created at sign-up.
3. Confirm you land on home with the onboarding checklist (*Get ready for your first meeting*).
4. **Reply to us with the Google email you used** so we can match your feedback to your session.

---

## Session record (fill in before you start)

| Field | Your answer |
|-------|-------------|
| **Name** | |
| **Google account email** | |
| **Date** | |
| **Browser + version** | e.g. Chrome 140 / Safari 18 |
| **OS + device** | e.g. macOS 15, MacBook Pro |
| **Persona** | e.g. staff engineer, runs 5 Zoom calls/week |
| **Meeting tool** | Zoom / Meet / Teams / solo rehearsal |
| **Knowledge Space name** | |
| **Sources added** | e.g. 1 repo + 2 PDFs |
| **Meeting context** | Real call / solo rehearsal / pair test |

---

## What we are validating

MeetHint is **cite-or-silence** meeting intelligence: during a technical conversation it should answer **only from material you connected**, with **verifiable citations**, or **stay quiet** when your files do not support an answer.

| Pillar | Success looks like |
|--------|-------------------|
| **Trust** | No confident wrong answers cited as “from your files” |
| **Coverage** | Questions your docs *do* answer get useful cited responses |
| **Silence** | Off-topic or unsupported questions do not invent facts |
| **Live UX** | Usable during a real or realistic call without breaking flow |
| **Persistence** | Your spaces and indexed material survive refresh and return visits |

**Performance target (informational):** p95 first supported answer under ~2 seconds in a typical Knowledge Space. Note if it feels much slower.

---

## Before you begin

### Prepare your test material (required)

Use **your own** content you are allowed to test with — **not** the built-in **Demo pack (sample only)**.

Bring at least **two** of:

- A **code repo** or project folder (Git URL or local folder upload)
- A **PDF** (spec, runbook, slide deck export, paper)
- **Office files** — DOCX, XLSX, CSV, PPT/PPTX
- Plain text / Markdown docs

You should know **3–5 factual answers** that *are* in your material and **2–3 questions** whose answers are **definitely not** in your material (for silence testing).

### Recommended environment

| Priority | Setup |
|----------|--------|
| **Best** | Chrome or Edge on desktop — mic + **meeting tab audio share** |
| **Good** | Safari on Mac — mic; type questions if tab audio is limited |
| **Limited** | iPhone / iPad — Ask + mic; full tab-audio Live needs desktop Chrome |

### Out of scope for this beta

Do not file as blockers:

- Missing dedicated “all my documents” hub (files live inside each Knowledge Space today)
- Cosmetic polish unless it blocks trust or usability
- Features not listed in this doc (billing, team sharing, server-side sync of uploads)

---

## Phase A — Account & security (≈15 min)

| ID | Test case | Steps | Expected result | P/F/N | Notes |
|----|-----------|-------|-----------------|-------|-------|
| **A-01** | Google sign-up | Open meethint.ai → **Sign in with Google** | Account created; lands on home or onboarding | | |
| **A-02** | Return visit | Sign out → sign back in with same Google account | Same spaces visible; no error loop | | |
| **A-03** | Account isolation | Confirm you only see **your** Knowledge Spaces | No other users’ spaces, names, or file content | | |
| **A-04** | Onboarding checklist | Find **Get ready for your first meeting** checklist | Steps visible: Sign in → Space → Sources → Index → Ask → Live | | |
| **A-05** | First impression | Write 1–2 sentences on first load | What confused or delighted you? | | |
| **A-06** | Privacy notice | Read beta privacy / telemetry notice if shown | Understand: files stay on device; export is opt-in | | |

**BLOCKER if:** Cannot sign in, session drops every navigation, or you see another account’s data.

---

## Phase B — Knowledge Space setup (≈25 min)

| ID | Test case | Steps | Expected result | P/F/N | Notes |
|----|-----------|-------|-----------------|-------|-------|
| **B-01** | Create space | **Create Knowledge Space** → pick type → name after real project | Space created; redirects to Add material | | |
| **B-02** | Add folder/repo | Upload repo, Git URL, or local folder | Indexing starts; sources count increases | | |
| **B-03** | Add files | Upload at least one non-PDF file (md, code, docx, etc.) | File appears in sources; indexing continues | | |
| **B-04** | Add PDF (if available) | Upload at least one PDF | PDF indexed; evidence spans increase | | |
| **B-05** | Indexing complete | Wait until **Ready** / indexing-complete | Stats show Sources > 0, Evidence spans > 0 | | |
| **B-06** | Index stats sanity | Note Sources, Evidence spans, Code symbols | Numbers plausible for what you uploaded | | |
| **B-07** | Space detail | Open Knowledge Space home | Name, sources, and scope note match your upload | | |
| **B-08** | Not demo pack | In Live/Ask, confirm active space is **yours**, not Demo pack | Demo pack not selected for this session | | |

**Record:** Sources ___ · Evidence spans ___ · Index time ___ min

---

## Phase C — Ask mode (cite or silence) (≈35 min)

Open **Ask** for your Knowledge Space (`/context/{id}/ask`).

### C1 — Supported answers

| ID | Test case | Your question (write it) | Expected result | P/F/N | Notes |
|----|-----------|--------------------------|-----------------|-------|-------|
| **C-01** | Factual in docs | _________________________ | Answer speaks; badge **From your files**; citation visible | | |
| **C-02** | “Where is…” | _________________________ | Cited answer points to correct file/location | | |
| **C-03** | “Who owns…” / owner | _________________________ | Cited answer or appropriate silence with reason | | |
| **C-04** | Open citation | Click citation chip / link | Opens correct file; snippet matches claim | | |
| **C-05** | Useful feedback | Tap 👍 **Useful** on a good answer | Feedback accepted; control shows sent state | | |

### C2 — Silence & trust

| ID | Test case | Your question (write it) | Expected result | P/F/N | Notes |
|----|-----------|--------------------------|-----------------|-------|-------|
| **C-06** | Not in docs | _________________________ | **Silent** — no invented fact; reason shown if UI explains silence | | |
| **C-07** | General knowledge | e.g. “What’s the weather today?” | Stays silent; no web-style guess | | |
| **C-08** | Off-topic after good answer | Ask supported Q, then unrelated Q | Second answer does **not** reuse first citation incorrectly | | |
| **C-09** | Adversarial / trick | Question designed to fool AI | Silent or correctly cited — **never** confident fiction with citation | | |
| **C-10** | Not useful feedback | Tap 👎 → pick reason (e.g. Wrong answer, Should have stayed silent) | Feedback recorded with category | | |

### C3 — UX & latency

| ID | Test case | Steps | Expected result | P/F/N | Notes |
|----|-----------|-------|-----------------|-------|-------|
| **C-11** | No free-form AI mode | Look for model picker / “generate without docs” toggle | **Not present** — docs-only product | | |
| **C-12** | Ask latency | Time first supported answer (rough) | Feels responsive (< ~5s perceived; note if >10s) | | |

**Critical failures:** C-06, C-07, C-09 if MeetHint speaks a **confident wrong answer with a citation**.

---

## Phase D — Live session (core product) (≈45 min)

Open **Live** for the same Knowledge Space. This is the primary beta surface.

### D1 — Start & capture

| ID | Test case | Steps | Expected result | P/F/N | Notes |
|----|-----------|-------|-----------------|-------|-------|
| **D-01** | Enter Live | Start Live / open Live cockpit | Cockpit loads; context status **ready** | | |
| **D-02** | Mic permission | Grant microphone when prompted | Mic indicator / listen state active | | |
| **D-03** | Tab audio (Chrome/Edge) | Share meeting tab with audio (or skip on Safari/mobile) | Call share / hear state engages without crash | | |
| **D-04** | Scope note | Read search scope note under Ask/Live | Shows your space name + source count | | |

### D2 — During “meeting” (minimum 15 minutes)

Use a **real call**, pair session, or solo rehearsal where you speak or type as if in a meeting.

| ID | Test case | Steps | Expected result | P/F/N | Notes |
|----|-----------|-------|-----------------|-------|-------|
| **D-05** | Spoken supported Q | Ask aloud something in your docs | Card appears with cited answer | | |
| **D-06** | Typed supported Q | Type question in Live search box | Same cite-or-silence behavior as Ask | | |
| **D-07** | Meeting chatter | Small talk, “thanks”, “can you hear me?” | Stays silent or ignores non-questions | | |
| **D-08** | Follow-up thread | Ask follow-up related to prior answered question | Coherent follow-up or appropriate silence | | |
| **D-09** | Unsupported during Live | Ask something not in docs | Silent — no hallucinated company facts | | |
| **D-10** | Answer history | Scroll / review answer history in cockpit | Prior Q&A listed with correct status | | |
| **D-11** | Live feedback | 👍 or 👎 on at least one Live answer | Feedback works same as Ask | | |
| **D-12** | Session duration | Keep Live running ≥15 min | No crash loop; can still ask questions at end | | |

### D3 — Artifacts in Live

| ID | Test case | Steps | Expected result | P/F/N | Notes |
|----|-----------|-------|-----------------|-------|-------|
| **D-13** | Session receipt | Open **Session receipt** from Live menu | Lists questions, cited vs unsupported counts | | |
| **D-14** | Copy/download receipt | Copy or download receipt text | Readable summary you could paste in email | | |
| **D-15** | PDF citation (if applicable) | If you indexed a PDF, trigger PDF-backed answer | PDF pane or document citation opens correctly | | |

---

## Phase E — Trust edge cases (≈20 min)

| ID | Test case | Steps | Expected result | P/F/N | Notes |
|----|-----------|-------|-----------------|-------|-------|
| **E-01** | Wrong citation | If any answer cites wrong file, record Q + citation | Note for HIGH severity review | | |
| **E-02** | Partial answer | Ask something only partly in docs | Either cites partial truth or stays silent — not invented middle | | |
| **E-03** | Multi-source | Ask spanning two files | Citations cover relevant sources | | |
| **E-04** | Stale question | Ask about content you did **not** upload | Silence | | |
| **E-05** | Rapid questions | 3 questions in quick succession | No crossed wires / wrong card stuck | | |
| **E-06** | Mobile (optional) | Repeat C-01 + C-06 on phone/tablet | Same trust behavior within platform limits | | |
| **E-07** | Silence reason | When silent, read any reason / explanation shown | Reason matches your understanding | | |
| **E-08** | Would trust in prod | Gut check after session | Would you rely on this in a customer call? Y/N + why | | |

---

## Phase F — Persistence & recovery (≈15 min)

| ID | Test case | Steps | Expected result | P/F/N | Notes |
|----|-----------|-------|-----------------|-------|-------|
| **F-01** | Refresh in Live | Hard refresh browser during/after Live | Space still there; re-enters ready state | | |
| **F-02** | Re-ask after refresh | Same supported question in Ask | Still answers correctly from your material | | |
| **F-03** | History after refresh | Check answer history | Prior session entries preserved (same device) | | |
| **F-04** | New browser tab | Open space in second tab | Consistent state; no duplicate corruption | | |
| **F-05** | Second device (optional) | Sign in elsewhere | **Expected:** uploads do **not** sync — re-add material or skip | | |

**BLOCKER if:** Indexed sources disappear after refresh, or spaces vanish without delete.

---

## Phase G — Wrap-up & deliverables (≈15 min)

| ID | Test case | Steps | Expected result | P/F/N | Notes |
|----|-----------|-------|-----------------|-------|-------|
| **G-01** | Diagnostics export | Live → **Diagnostics** → download JSON | File downloads; no raw file contents inside | | |
| **G-02** | Attach diagnostics | Email JSON to your MeetHint contact | We can read timings / quality summary | | |
| **G-03** | Complete this doc | Fill Pass/Fail/Notes column for every phase | All rows addressed or marked N/A | | |
| **G-04** | Schedule debrief | Book or confirm async debrief within 5 days | Date: __________ | | |

---

## Optional — Phase H (async)

| ID | Test case | When | Expected result | P/F/N | Notes |
|----|-----------|------|-----------------|-------|-------|
| **H-01** | Day 1 return | 24–48h later | Sign in; spaces still present; can Ask/Live again | | |
| **H-02** | Second real meeting | Within 7 days | Product usable again without re-onboarding from scratch | | |

---

## Experience ratings (required — circle 1–5)

1 = poor · 3 = okay · 5 = excellent

| Area | 1 | 2 | 3 | 4 | 5 |
|------|---|---|---|---|---|
| Google sign-up and first login | | | | | |
| Creating a Knowledge Space | | | | | |
| Adding and indexing material | | | | | |
| Ask — answer quality | | | | | |
| Ask — citation quality | | | | | |
| Live — ease during a meeting | | | | | |
| Live — speed / latency | | | | | |
| Trust — would you rely on cited answers? | | | | | |
| Overall (after full session) | | | | | |

**NPS (0–10):** How likely are you to recommend MeetHint? ___  
**Main reason for your score:**

---

## Moment log (required — be specific)

| Prompt | Your answer |
|--------|-------------|
| **Best moment** — when did MeetHint earn trust? | |
| **Worst moment** — when did trust break? | |
| **What almost made you quit?** | |
| **What surprised you** (good or bad)? | |

---

## Answer feedback log (strongly encouraged)

Log at least 5 Q&A pairs. Use 👍/👎 in the product **and** record here.

| # | Question | Cited? | 👍/👎 | Reason if 👎 | What should it have done? |
|---|----------|--------|-------|--------------|---------------------------|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |

---

## Debrief questionnaire (required)

Copy your answers into the reply email or debrief call notes.

1. **Overall:** One sentence — what is MeetHint *for*, in your words?
2. **Trust:** Did any answer feel **confident but wrong**? Paste question + answer + citation if yes.
3. **Silence:** Did it stay silent when it should? Speak when it shouldn’t?
4. **Citations:** Were citations **accurate and worth clicking**?
5. **Live:** Could you use this **without breaking meeting flow**?
6. **Setup:** Biggest friction — sign-in, indexing, permissions, UI, latency?
7. **Missing:** What did you expect that wasn’t there?
8. **Compare:** vs ChatGPT / Copilot / internal search / nothing?
9. **Fit:** Which meetings would you use this in? Which would you **not**?
10. **Willingness to pay:** Would you pay today? What would make it a no-brainer?
11. **Build next:** One feature we should prioritize.
12. **Simplify:** One thing we should remove or simplify.
13. **Recommendation:** Would you invite a colleague to the next beta wave? Why or why not?
14. **Open:** Anything else — rant, praise, or idea welcome.
15. **Severity:** Any **BLOCKER** or **HIGH** issue? (See reporting guide below.)

---

## How to report issues

Use subject line **`MeetHint Beta — [BLOCKER|HIGH|MEDIUM|LOW] — short title`**

| Severity | When to use | Examples |
|----------|-------------|----------|
| **BLOCKER** | Cannot proceed; data leak; data loss | Can’t sign in; see others’ spaces; sources gone after refresh |
| **HIGH** | Trust or core value broken | Wrong cited answer; Live never answers; indexing stuck forever |
| **MEDIUM** | Usable but confusing | Wrong snippet on citation; unclear next step; slow but works |
| **LOW** | Polish | Typos, spacing, nice-to-have |

Full rubric: [BETA-ISSUE-TRIAGE.md](./BETA-ISSUE-TRIAGE.md)

---

## What to send back

Email your MeetHint contact with:

1. **Your Google account email** (so we can match your session)
2. **Completed session record** + Pass/Fail/Notes (or annotated PDF)
3. **Experience ratings + NPS + moment log** (required)
4. **Answer feedback log** (at least 5 rows, strongly encouraged)
5. **Debrief answers** — all 15 questions (required)
6. **Diagnostics JSON** from Live (required)
7. **Screenshots** of any wrong cited answers (strongly encouraged)
8. **Session receipt** text (optional)

---

## Facilitator checklist (MeetHint team)

- [ ] Assign Tester ID (W1-01 … W1-05) for internal tracking
- [ ] Tester registers at meethint.ai with **Sign in with Google**
- [ ] Collect tester’s **Google email** when they reply
- [ ] Send [MeetHint-Beta-Testing-Session.pdf](./MeetHint-Beta-Testing-Session.pdf) + this doc
- [ ] Confirm tester prepared own material (not Demo pack)
- [ ] Schedule debrief within 5 days
- [ ] Log issues in [BETA-ISSUE-TRIAGE.md](./BETA-ISSUE-TRIAGE.md)
- [ ] Update scorecard in [archive/BETA-WAVE-1.md](./archive/BETA-WAVE-1.md)

---

## Copy-paste invite email

```
Subject: MeetHint beta — structured testing session (~2.5 hours)

Hi — thank you for helping test MeetHint.

We’re running a structured testing session (not a casual demo). Plan about 2–2.5 hours with your own repo/docs loaded.

Get started:
1. Go to https://www.meethint.ai
2. Click Sign in with Google (no invite code needed)
3. Reply to this email with the Google address you used

Before the session:
• Chrome or Edge on desktop if possible
• Your own project folder/repo and/or PDFs
• Know 3–5 questions your docs CAN answer and 2–3 they CANNOT

During the session:
• Follow the attached guide phase by phase
• Mark Pass/Fail on every test case
• Rate each area 1–5 and 👍/👎 every answer you can
• Export Diagnostics JSON from Live when finished
• Send back: completed PDF + ratings + debrief + JSON

What we care about most: cited answers from YOUR files, silence when unsupported, and whether you’d trust this in a real technical meeting.

Blockers: put BLOCKER in the subject.

Attached: MeetHint-Beta-Testing-Session.pdf

Thanks,
[Your name]
```
