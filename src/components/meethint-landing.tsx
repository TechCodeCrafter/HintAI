import { ArrowRight, Check, Loader2, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { highlightAnswer } from "@/components/answer-say";
import { MeetHintMark } from "@/components/meethint-mark";
import { MEETHINT_DOMAIN, MEETHINT_MARK, MEETHINT_NAME } from "@/lib/brand";
import { demoMediaUrl } from "@/lib/demo-media";
import { joinWaitlist } from "@/lib/waitlist";
import "@/styles/hint-landing-a11y.css";

type Phase = "listening" | "asking" | "detected" | "searching" | "answered";

type Beat = {
  asked: string;
  files: string[];
  fileCount: number;
  answer: string | null;
  source: { file: string; detail: string } | null;
  silence: string | null;
};

const BEATS: Beat[] = [
  {
    asked: "Does the contract allow automatic renewal?",
    files: ["MSA.pdf", "addendum.pdf", "pricing.pdf", "notes.md"],
    fileCount: 47,
    answer: "Yes. The agreement renews for successive 12-month periods unless either party provides 60 days' written notice.",
    source: { file: "MSA.pdf", detail: "§8.2 · p.17" },
    silence: null,
  },
  {
    asked: "What does the lab report actually have to include?",
    files: ["lab-requirements.pdf", "notes.md", "syllabus.pdf", "lecture-04.pdf"],
    fileCount: 38,
    answer: "Methods, results, and a one-page discussion.",
    source: { file: "lab-requirements.pdf", detail: "Page 12" },
    silence: null,
  },
  {
    asked: "Do we have a data processing agreement with them?",
    files: ["MSA.pdf", "addendum.pdf", "pricing.pdf", "notes.md"],
    fileCount: 47,
    answer: null,
    source: null,
    silence: "Your material doesn't cover this",
  },
];

type MaterialChip = {
  label: string;
  note?: "limits" | "soon";
};

/** File formats MeetHint can cite today — badges must match what load paths actually support. */
const MATERIAL: MaterialChip[] = [
  { label: "Notes" },
  { label: "Lectures" },
  { label: "Syllabi" },
  { label: "Folders" },
  { label: "PDF", note: "limits" },
  { label: "DOCX" },
  { label: "XLSX" },
  { label: "CSV" },
  { label: "Markdown" },
  { label: "Code" },
  { label: "Repositories" },
  { label: "PPTX", note: "soon" },
];

const USE_CASES = [
  {
    title: "Class & office hours",
    asked: "What did lecture four actually cover?",
    found: "lecture-04.pdf + notes",
  },
  {
    title: "Incident review",
    asked: "Why did authentication fail?",
    found: "incident-582.md + runbook",
  },
  {
    title: "Client & contract",
    asked: "Does the agreement auto-renew?",
    found: "MSA.pdf · §8.2",
  },
  {
    title: "Sales call",
    asked: "Does the enterprise plan include SSO?",
    found: "pricing.pdf + product overview",
  },
  {
    title: "Presentation",
    asked: "Which source supports this claim?",
    found: "deck appendix + research",
  },
] as const;

const STEPS = [
  { id: "01", title: "Listening", body: `${MEETHINT_NAME} picks up the question that is actually being asked.` },
  { id: "02", title: "Searching your files", body: "It searches the notes, docs, slides, or folder you loaded." },
  { id: "03", title: "Finding the match", body: `${MEETHINT_NAME} pulls the passage that answers the question.` },
  { id: "04", title: "Cited answer ready", body: "You get the answer with the file and line that support it." },
] as const;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useDemoCycle(beats: Beat[]) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("listening");
  const [typed, setTyped] = useState("");
  const timers = useRef<number[]>([]);
  const beat = beats[index] ?? beats[0];

  useEffect(() => {
    const clear = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
    const after = (ms: number, run: () => void) => {
      timers.current.push(window.setTimeout(run, ms));
    };

    clear();
    setPhase("listening");
    setTyped(reduced ? beat.asked : "");
    const advance = () => setIndex((current) => (current + 1) % beats.length);

    if (reduced) {
      after(800, () => setPhase("detected"));
      after(1400, () => setPhase("searching"));
      after(2200, () => setPhase("answered"));
      after(7000, advance);
      return clear;
    }

    after(1100, () => setPhase("asking"));
    const perChar = 22;
    beat.asked.split("").forEach((_, i) => {
      after(1100 + perChar * (i + 1), () => setTyped(beat.asked.slice(0, i + 1)));
    });
    const askDone = 1100 + perChar * beat.asked.length;
    after(askDone + 280, () => setPhase("detected"));
    after(askDone + 900, () => setPhase("searching"));
    after(askDone + 1900, () => setPhase("answered"));
    after(askDone + 1900 + (beat.answer || beat.silence ? 5200 : 4200), advance);
    return clear;
  }, [beat, beats.length, reduced]);

  return {
    beat,
    phase,
    question: phase === "listening" ? "" : phase === "asking" ? typed : beat.asked,
    reduced,
    typing: phase === "asking" && !reduced,
  };
}

function statusLabel(phase: Phase, fileCount: number): string {
  if (phase === "listening") return "Listening";
  if (phase === "asking") return "Listening";
  if (phase === "detected") return "Question detected";
  if (phase === "searching") return `Searching ${fileCount} files`;
  return "Answer ready";
}

function ProductFrame({
  tone,
  phase,
  question,
  beat,
  typing,
  large,
}: {
  tone: "light" | "dark";
  phase: Phase;
  question: string;
  beat: Beat;
  typing?: boolean;
  large?: boolean;
}) {
  const dark = tone === "dark";
  const found = phase === "answered" && Boolean(beat.source);
  const silent = phase === "answered" && Boolean(beat.silence);
  const ready = phase === "answered" && (beat.answer || beat.silence);
  const muted = dark ? "text-white/45" : "text-[var(--hint-muted)]";
  const ink = dark ? "text-white" : "text-[var(--hint-text)]";
  const edge = dark ? "border-white/10" : "border-[var(--hint-border)]";
  const soft = dark ? "bg-white/[0.04]" : "bg-[var(--hint-bg)]";
  const label = `text-[11px] font-medium tracking-[0.08em] uppercase ${muted}`;

  return (
    <div className={`hint-frame ${dark ? "hint-frame-dark" : "hint-frame-light"}`}>
      <div className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${edge} ${large ? "sm:px-5" : ""}`}>
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              phase === "answered" && (beat.answer || beat.silence) ? "bg-[var(--hint-ok)]" : "bg-[var(--hint-accent)]"
            } ${phase === "listening" || phase === "asking" || phase === "searching" ? "hint-pulse" : ""}`}
          />
          <span
            className={`text-[13px] font-medium ${ready ? "text-[var(--hint-ok)]" : ink}`}
          >
            {statusLabel(phase, beat.fileCount)}
          </span>
        </div>
        <span className={`hidden text-[12px] sm:block ${muted}`}>{beat.fileCount} files</span>
      </div>

      <div className={`grid sm:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] ${large ? "min-h-[24rem]" : "min-h-[21rem]"}`}>
        <div className={`border-b p-4 sm:border-r sm:border-b-0 ${edge} ${large ? "sm:p-5" : ""}`}>
          <p className={`mb-3 ${label}`}>Files</p>
          <ul className="space-y-1.5">
            {beat.files.map((file) => {
              const active = found && beat.source?.file === file;
              return (
                <li
                  key={file}
                  className={`rounded-md px-2.5 py-1.5 text-[13px] ${
                    active
                      ? dark
                        ? "bg-[color-mix(in_srgb,var(--hint-accent)_18%,transparent)] text-white"
                        : "bg-[color-mix(in_srgb,var(--hint-accent)_8%,transparent)] text-[var(--hint-text)]"
                      : muted
                  }`}
                >
                  {file}
                </li>
              );
            })}
          </ul>
        </div>

        <div className={`space-y-4 p-4 ${large ? "sm:p-5 sm:py-6" : ""}`}>
          {phase === "answered" && beat.answer ? null : (
            <div className="space-y-2">
              <p className={label}>They asked</p>
              <p className={`text-[1.05rem] leading-snug ${ink} ${typing ? "hint-type" : ""}`}>
                {question ? `“${question}”` : <span className={muted}>Waiting for a question.</span>}
              </p>
            </div>
          )}

          {phase === "detected" ? (
            <p className={`hint-fade text-[13px] font-medium text-[var(--hint-accent)]`}>Question detected</p>
          ) : null}

          {phase === "searching" ? (
            <p className={`hint-scan hint-fade rounded-md px-3 py-2 text-[13px] ${soft} ${ink}`}>
              Searching {beat.fileCount} files…
            </p>
          ) : null}

          {phase === "answered" && beat.answer ? (
            <div className="hint-fade space-y-4">
              <div className="space-y-2">
                <p className={label}>They asked</p>
                <p className={`text-[1.05rem] font-semibold leading-snug ${ink}`}>
                  {question ? `“${question}”` : null}
                </p>
              </div>
              <p className={`text-[15px] leading-relaxed ${ink}`}>{highlightAnswer(beat.answer)}</p>
              {beat.source ? (
                <div className="cite-chip">
                  <Check className="size-3.5 shrink-0 text-[var(--hint-ok)]" aria-hidden="true" />
                  <span className="cite-status">Verified</span>
                  <span className="break-all font-mono text-[12px] text-[var(--hint-text)]">{beat.source.file}</span>
                  <span className="font-mono text-[12px] text-[var(--hint-muted)]">{beat.source.detail}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {silent ? (
            <div className="hint-fade space-y-4">
              <div className="answer-receipt">
                <div className="answer-receipt-body">
                  <div className="min-w-0">
                    <p className="receipt-kicker">They asked</p>
                    <p className="mt-2 text-[17px] font-semibold leading-snug text-[var(--hint-text)]">
                      {question ? `“${question}”` : null}
                    </p>
                  </div>
                  <p className="text-[15px] leading-relaxed text-[var(--hint-muted)]">{beat.silence}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function HeroInterface() {
  const demo = useDemoCycle(BEATS);
  return (
    <ProductFrame
      tone="light"
      phase={demo.phase}
      question={demo.question}
      beat={demo.beat}
      typing={demo.typing}
    />
  );
}

function DemoVideo() {
  const reduced = useReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (reduced) video.current?.pause();
  }, [reduced]);

  function playDemo() {
    const element = video.current;
    if (!element) return;
    element.muted = false;
    element.currentTime = 0;
    void element.play();
    setPlaying(true);
  }

  return (
    <section className="hint-wrap space-y-8 py-20">
      <div className="mx-auto max-w-2xl space-y-2 text-center">
        <h2 className="hint-display text-3xl sm:text-4xl">Watch it keep up.</h2>
        <p className="text-[17px] text-[var(--hint-muted)]">
          45 seconds, one real question, one cited answer.
        </p>
      </div>
      <div className="hint-frame hint-frame-dark relative mx-auto max-w-4xl overflow-hidden">
        <video
          ref={video}
          className="block aspect-video w-full bg-[#0c1018]"
          src={demoMediaUrl("meethint-demo-cutaway.mp4")}
          poster="/demo/meethint-demo-cutaway-poster.jpg"
          preload="metadata"
          playsInline
          controls={playing}
          onPlay={() => setPlaying(true)}
          onEnded={() => setPlaying(false)}
        />
        {!playing ? (
          <>
            <button type="button" className="hint-demo-play" onClick={playDemo}>
              <Play aria-hidden className="size-4 fill-[var(--hint-accent)] text-[var(--hint-accent)]" />
              Play demo
            </button>
            <span className="hint-demo-duration" aria-hidden>
              0:45 · sound on
            </span>
          </>
        ) : null}
      </div>
    </section>
  );
}

type FormState = "idle" | "sending" | "done" | "error";

function WaitlistForm({ id }: { id: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");

  useEffect(() => {
    if (window.localStorage.getItem("meethint.waitlist")) setState("done");
  }, []);

  const valid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()), [email]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || state === "sending") return;
    setState("sending");
    try {
      const result = await joinWaitlist({ data: { email: email.trim(), source: id } });
      if (!result.ok) throw new Error(result.reason);
      window.localStorage.setItem("meethint.waitlist", email.trim());
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--hint-accent)]" data-testid="waitlist-done" role="status">
        <Check aria-hidden className="size-4" />
        You're on the list. We'll be in touch before the first calls go live.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-center" noValidate>
      <div className="hint-waitlist-row">
        <label className="sr-only" htmlFor={id}>
          Email address
        </label>
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          data-testid={`${id}-input`}
          className="hint-waitlist-input min-w-0 flex-1 rounded-[10px] border border-[var(--hint-border)] bg-white px-3.5 text-[var(--hint-text)] outline-none placeholder:text-[var(--hint-muted)] focus:border-[var(--hint-accent)]"
          placeholder="Enter your email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (state === "error") setState("idle");
          }}
        />
        <button
          type="submit"
          data-testid={`${id}-submit`}
          className="hint-btn hint-btn-primary hint-waitlist-submit shrink-0"
          disabled={!valid || state === "sending"}
        >
          {state === "sending" ? <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" /> : null}
          Join the private beta
        </button>
      </div>
      {state === "error" ? (
        <p className="text-sm text-red-600" role="alert">
          That didn't go through. Try again in a moment.
        </p>
      ) : (
        <p className="text-sm text-[var(--hint-muted)]">No spam, no sharing. One note when the beta opens.</p>
      )}
    </form>
  );
}

function HowHintWorks() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setActive((current) => (current + 1) % STEPS.length), 2800);
    return () => window.clearInterval(id);
  }, [reduced]);

  return (
    <div className="relative">
      <span aria-hidden className="absolute top-10 bottom-10 left-4 w-px bg-[var(--hint-border)] sm:hidden" />
      <span aria-hidden className="hint-step-line absolute top-4 right-[12.5%] left-[12.5%] hidden sm:block" />
      <ol className="relative grid gap-0 sm:grid-cols-4">
      {STEPS.map((step, index) => (
        <li key={step.id} className="relative flex gap-4 py-5 sm:block sm:py-0">
          <div
            className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-[var(--hint-surface)] text-[12px] tabular-nums ${
              active === index
                ? "border-[var(--hint-accent)] text-[var(--hint-accent)]"
                : "border-[var(--hint-border)] text-[var(--hint-muted)]"
            }`}
          >
            {step.id}
          </div>
          <div
            className={`min-w-0 space-y-2 sm:mt-5 sm:pr-6 ${
              active === index ? "opacity-100" : "opacity-80"
            }`}
          >
            <p className="font-medium text-[var(--hint-text)]">{step.title}</p>
            <p className="text-[15px] leading-relaxed text-[var(--hint-muted)]">{step.body}</p>
          </div>
        </li>
      ))}
      </ol>
    </div>
  );
}

const CONTRACT_BEAT: Beat = BEATS[0];

export function MeetHintLanding() {
  const demoRef = useRef<HTMLElement>(null);

  function watchDemo() {
    demoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="hint-landing min-h-dvh" data-testid="landing">
      <header className="hint-nav sticky top-0 z-20">
        <div className="hint-wrap flex items-center justify-between gap-6 py-3">
          <a href="/" className="flex items-center gap-2.5">
            <MeetHintMark className="size-8" />
            <span className="text-[1.15rem] font-semibold tracking-tight leading-none">{MEETHINT_MARK}</span>
          </a>
          <div className="flex items-center gap-8">
            <nav className="hidden items-center gap-7 text-[15px] text-[var(--hint-muted)] md:flex">
              <a href="#product" className="hover:text-[var(--hint-text)]">
                Product
              </a>
              <a href="#use-cases" className="hover:text-[var(--hint-text)]">
                Use cases
              </a>
              <a href="/security" className="hover:text-[var(--hint-text)]">
                Security
              </a>
              <a href="#docs" className="hover:text-[var(--hint-text)]">
                Docs
              </a>
            </nav>
            <a href="/home" className="hint-btn hint-btn-primary !text-white">
              Try {MEETHINT_MARK}
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="hint-wrap grid items-center gap-12 py-16 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-16 lg:py-24">
          <div className="space-y-7">
            <p className="hint-kicker">Live answers from your own material</p>
            <h1 className="hint-display text-[2.6rem] sm:text-5xl lg:text-[3.4rem]">
              Know the answer
              <span className="block">while they're still asking.</span>
            </h1>
            <p className="hint-lede max-w-md">
              {MEETHINT_MARK} listens to the conversation, searches the material you trust, and surfaces a cited
              answer in seconds.
            </p>
            <div className="flex flex-col gap-3 pt-1 sm:flex-row">
              <a href="/home" className="hint-btn hint-btn-primary !text-white [&_svg]:text-white">
                Try {MEETHINT_MARK}
                <ArrowRight aria-hidden className="size-4 shrink-0" />
              </a>
              <button type="button" className="hint-btn hint-btn-secondary" onClick={watchDemo}>
                <Play aria-hidden className="size-4 shrink-0 fill-[var(--hint-text)] text-[var(--hint-text)]" />
                Watch 45 sec demo
              </button>
            </div>
            <p className="max-w-md text-[14px] text-[var(--hint-muted)]">
              Bring a lecture, a contract, a folder, or your own notes. {MEETHINT_MARK} keeps it local and cites
              exactly.
            </p>
          </div>
          <HeroInterface />
        </section>

        <section id="product" className="hint-wrap space-y-12 py-20">
          <div className="max-w-2xl space-y-3">
            <h2 className="hint-display text-3xl sm:text-4xl">How {MEETHINT_NAME} works in real time</h2>
            <p className="text-[17px] text-[var(--hint-muted)]">
              Someone asks. {MEETHINT_MARK} hears it, searches your files, and shows the passage — or stays quiet.
            </p>
          </div>
          <HowHintWorks />
          <p className="hint-display text-center text-2xl sm:text-3xl">Cite it, or stay silent.</p>
        </section>

        <section ref={demoRef} id="demo" className="bg-[var(--hint-demo)] text-white">
          <div className="hint-wrap space-y-10 py-20 lg:py-24">
            <div className="mx-auto max-w-2xl space-y-5 text-center">
              <p className="text-[12px] font-semibold tracking-[0.08em] text-white/45 uppercase">
                See {MEETHINT_NAME} in action
              </p>
              <h2 className="hint-display text-4xl text-white sm:text-6xl">
                A real answer.
                <span className="block">Backed by your source.</span>
              </h2>
              <p className="text-[17px] leading-relaxed text-white/60">
                {MEETHINT_NAME} does not give you a guess. It finds the relevant passage, shows the source, and
                keeps you grounded in your own material.
              </p>
            </div>
            <div className="mx-auto max-w-5xl">
              <ProductFrame tone="dark" phase="answered" question={CONTRACT_BEAT.asked} beat={CONTRACT_BEAT} large />
            </div>
            <p className="text-center text-[14px] text-white/45">
              Same conversation. Same question. Real citations, right when you need them.
            </p>
          </div>
        </section>

        <DemoVideo />

        <section className="hint-wrap space-y-8 py-20">
          <div className="max-w-2xl space-y-4">
            <h2 className="hint-display text-3xl sm:text-4xl">Bring the material.</h2>
            <p className="text-[17px] leading-relaxed text-[var(--hint-muted)]">
              Load your notes, a lecture pack, the syllabus, a contract, or a folder of docs. {MEETHINT_MARK}
              keeps it local and cites exactly.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {MATERIAL.map(({ label, note }) => (
              <span
                key={label}
                className={`hint-chip${note === "soon" ? " hint-chip-soon" : note === "limits" ? " hint-chip-limits" : ""}`}
              >
                {label}
                {note ? <span className="ml-1 text-[var(--hint-muted)]">{note}</span> : null}
              </span>
            ))}
          </div>
          <p className="max-w-2xl text-[14px] leading-relaxed text-[var(--hint-muted)]">
            Add PDFs separately (page and size limits apply). Git-history answers ship on the
            built-in demo pack only.
          </p>
        </section>

        <section className="hint-wrap space-y-10 py-6 pb-20">
          <div className="max-w-2xl space-y-4">
            <h2 className="hint-display text-3xl sm:text-4xl">Answers with receipts.</h2>
            <p className="text-[17px] leading-relaxed text-[var(--hint-muted)]">
              If your material supports the answer, {MEETHINT_NAME} shows you where it came from. If it does not,
              it stays silent.
            </p>
          </div>
          <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <div className="hint-card space-y-2 p-5">
              <p className="text-[12px] text-[var(--hint-muted)]">Question</p>
              <p className="text-[17px] leading-snug">“Does the enterprise plan support SSO?”</p>
            </div>
            <div className="hidden items-center text-[var(--hint-muted)] md:flex" aria-hidden>
              →
            </div>
            <div className="hint-card space-y-2 p-5">
              <p className="text-[12px] text-[var(--hint-muted)]">Answer</p>
              <p className="text-[17px] leading-snug">Yes.</p>
            </div>
            <div className="hidden items-center text-[var(--hint-muted)] md:flex" aria-hidden>
              →
            </div>
            <div className="hint-card space-y-2 p-5">
              <p className="text-[12px] text-[var(--hint-muted)]">Citation</p>
              <p className="flex items-center gap-2 text-[15px]">
                <span className="size-1.5 rounded-full bg-[var(--hint-ok)]" />
                <span>pricing.pdf</span>
                <span className="text-[var(--hint-muted)]">Page 8</span>
              </p>
            </div>
          </div>
        </section>

        <section id="use-cases" className="hint-wrap space-y-10 py-16">
          <h2 className="hint-display max-w-2xl text-3xl sm:text-4xl">Any room. Their question. Your source.</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {USE_CASES.map((item) => (
              <article key={item.title} className="hint-card space-y-5 p-5">
                <p className="text-[13px] text-[var(--hint-muted)]">{item.title}</p>
                <p className="text-[1.15rem] leading-snug font-medium">“{item.asked}”</p>
                <p className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="size-1.5 rounded-full bg-[var(--hint-accent)]" />
                  <span className="text-[var(--hint-muted)]">Found in</span>
                  <span>{item.found}</span>
                </p>
              </article>
            ))}
            <article className="hint-card flex flex-col justify-between gap-6 p-5">
              <p className="text-[13px] text-[var(--hint-muted)]">Your files</p>
              <div className="space-y-2">
                <p className="text-[1.15rem] font-medium">Their question.</p>
                <p className="text-[1.15rem] font-medium text-[var(--hint-accent)]">Your cited answer.</p>
              </div>
            </article>
          </div>
        </section>

        <section id="security" className="hint-wrap py-16">
          <div className="mx-auto max-w-2xl space-y-4 text-center">
            <h2 className="hint-display text-3xl sm:text-4xl">Local. Cited. Quiet when it should be.</h2>
            <p className="text-[17px] leading-relaxed text-[var(--hint-muted)]">
              {MEETHINT_NAME} reads the folder on your machine. It does not add cloud connectors, and it does not
              invent a source. If the files do not support the answer, the card stays empty.
            </p>
            <p>
              <a id="docs" href="/home" className="text-[15px] font-medium text-[var(--hint-accent)] hover:underline">
                Read the docs.
              </a>
            </p>
          </div>
        </section>

        <section className="hint-wrap py-20">
          <div className="hint-card space-y-8 px-6 py-10 sm:px-12 sm:py-14">
            <div className="mx-auto max-w-2xl space-y-4 text-center">
              <h2 className="hint-display text-3xl sm:text-4xl">Search that can keep up with speech.</h2>
              <p className="text-[17px] leading-relaxed text-[var(--hint-muted)]">
                Bring the material once. {MEETHINT_NAME} stays with the conversation and cites what it finds
                before the room moves on.
              </p>
            </div>
            <div className="mx-auto max-w-lg">
              <WaitlistForm id="hero-email" />
            </div>
            <p className="text-center text-[15px] text-[var(--hint-muted)]">Cite it, or stay silent.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--hint-border)]">
        <div className="hint-wrap flex flex-col gap-6 py-8 text-[13px] text-[var(--hint-muted)] sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-lg font-semibold text-[var(--hint-text)]">{MEETHINT_MARK}</p>
            <p>{MEETHINT_DOMAIN}</p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" data-testid="landing-footer-trust-nav">
            <a href="#product" className="hover:text-[var(--hint-text)]">
              Product
            </a>
            <a href="/privacy" className="hover:text-[var(--hint-text)]">
              Privacy
            </a>
            <a href="/terms" className="hover:text-[var(--hint-text)]">
              Terms
            </a>
            <a href="/security" className="hover:text-[var(--hint-text)]">
              Security
            </a>
            <a href="/contact" className="hover:text-[var(--hint-text)]">
              Contact
            </a>
          </nav>
          <a href="/home" className="hover:text-[var(--hint-text)]">
            Open app
          </a>
        </div>
      </footer>
    </div>
  );
}
