import {
  Activity,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Handshake,
  Loader2,
  Mic,
  Presentation,
  Quote,
  ShieldCheck,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MeetHintMark } from "@/components/meethint-mark";
import { joinWaitlist } from "@/lib/waitlist";

/**
 * One turn of the meeting the demo card replays.
 *
 * A beat resolves to sources, never to a sentence. MeetHint's output contract is
 * a file and a line with the fact compressed next to it — the talking stays with
 * the person, which is also why nothing here is phrased to be read aloud.
 */
type SourceKind = "code" | "doc" | "pr";

type Beat = {
  session: string;
  material: string;
  /** When the viewer last touched this material — the reason they need it. */
  cold: string | null;
  asked: string;
  /** Empty is the point of the product: the material did not cover it. */
  sources: { at: string; fact: string; kind: SourceKind }[];
};

const SOURCE_ICON: Record<SourceKind, typeof FileCode2> = {
  code: FileCode2,
  doc: FileText,
  pr: GitPullRequest,
};

/**
 * Deliberately shares no question, file or session with the film below: the card
 * and the video are two windows onto the same product, not the same clip twice.
 * The checkout-recovery story and the SOC 2 refusal belong to the video.
 */
const BEATS: Beat[] = [
  {
    session: "Ingest handover",
    material: "repo · operations-guide.pdf",
    cold: "last commit by you: Nov 2024",
    asked: "What happens if the processing fails?",
    sources: [
      {
        at: "lambda_function.py:83",
        fact: "retries to MAX_ATTEMPTS, then dead-letters",
        kind: "code",
      },
      { at: "operations-guide.pdf · p. 14", fact: "failed jobs stay FAILED until replay", kind: "doc" },
    ],
  },
  {
    session: "Finance sync",
    material: "billing/ · finance-spec.pdf",
    cold: "shipped before the team was three people",
    asked: "Does the export handle multi-currency?",
    sources: [
      { at: "billing/export.ts:118", fact: "converts at the booking-date rate", kind: "code" },
      { at: "finance-spec.pdf · p. 7", fact: "no rounding after conversion", kind: "doc" },
    ],
  },
  {
    session: "Northwind renewal",
    material: "MSA · addendum · pricing",
    cold: "signed 14 months ago",
    asked: "What did we promise them on uptime?",
    sources: [
      { at: "support-addendum.pdf · p. 3", fact: "99.9% monthly, credits after the second breach", kind: "doc" },
      { at: "PR #1990", fact: "status page split per region", kind: "pr" },
    ],
  },
  {
    session: "Northwind renewal",
    material: "MSA · addendum · pricing",
    cold: null,
    asked: "Do we have a data processing agreement with them?",
    sources: [],
  },
];

const MATERIAL = [
  { icon: FileText, label: "PDF" },
  { icon: FileText, label: "DOCX" },
  { icon: Presentation, label: "PPTX" },
  { icon: FileSpreadsheet, label: "Sheets" },
  { icon: FileCode2, label: "Markdown" },
  { icon: FileCode2, label: "Code" },
  { icon: FolderOpen, label: "Whole folder" },
  { icon: GitBranch, label: "Repository" },
];

/** Ordered by how cold the material usually is, not by how flashy the demo is. */
const USE_CASES = [
  {
    icon: FileCode2,
    title: "Architecture review",
    bring: ["The repo", "ADRs", "Design docs", "Requirements"],
  },
  {
    icon: Activity,
    title: "Incident & postmortem",
    bring: ["Incident notes", "Runbooks", "PR history", "Dashboards export"],
  },
  {
    icon: BriefcaseBusiness,
    title: "Client & contract",
    bring: ["MSA", "Statement of work", "Proposal", "Amendments"],
  },
  {
    icon: Handshake,
    title: "Sales call",
    bring: ["Product docs", "Pricing", "Objection playbook", "Account history"],
  },
  {
    icon: Presentation,
    title: "Presentation",
    bring: ["The deck", "Research", "Supporting documents", "Appendix"],
  },
];

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

type Phase = "asking" | "searching" | "answered";

/**
 * Replays the product: a question arrives, the material is searched, the file
 * and line it came from appear. The last beat is the one that matters most —
 * nothing supports an answer, so there isn't one.
 */
function DemoCard() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("asking");
  const [typed, setTyped] = useState("");
  const timers = useRef<number[]>([]);

  const beat = BEATS[index];

  useEffect(() => {
    const clear = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
    const after = (ms: number, run: () => void) => {
      timers.current.push(window.setTimeout(run, ms));
    };

    clear();
    setPhase("asking");
    setTyped(reduced ? beat.asked : "");

    const advance = () => setIndex((current) => (current + 1) % BEATS.length);

    if (reduced) {
      after(700, () => setPhase("searching"));
      after(1500, () => setPhase("answered"));
      after(7000, advance);
      return clear;
    }

    // Type the question a character at a time, then search, then answer.
    const perChar = 26;
    beat.asked.split("").forEach((_, i) => {
      after(perChar * (i + 1), () => setTyped(beat.asked.slice(0, i + 1)));
    });
    const askDone = perChar * beat.asked.length;
    after(askDone + 420, () => setPhase("searching"));
    after(askDone + 1180, () => setPhase("answered"));
    after(askDone + 1180 + (beat.sources.length ? 5200 : 4200), advance);

    return clear;
  }, [beat, reduced]);

  const question = phase === "asking" ? typed : beat.asked;

  return (
    <div className="mh-panel mh-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="live-dot inline-block size-2 shrink-0 rounded-full bg-accent shadow-glow" />
          <span className="mh-eyebrow text-accent">Listening</span>
          <span className="truncate text-xs text-faint">· {beat.session}</span>
        </div>
        <span className="hidden shrink-0 text-xs text-faint sm:block">{beat.material}</span>
      </div>

      <div className="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        <div className="space-y-2">
          <p className="mh-eyebrow">They asked</p>
          <p
            className={`mh-utterance text-body ${
              phase === "asking" && !reduced ? "mh-type" : ""
            }`}
          >
            {question}
          </p>
        </div>

        <div className="mh-rule" />

        {phase === "answered" ? (
          <div key={`${index}-answer`} className="mh-swap mh-answer space-y-3">
            {beat.sources.length ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="mh-eyebrow">From your material</p>
                  {beat.cold ? <p className="text-xs text-faint">{beat.cold}</p> : null}
                </div>
                <ul className="mh-source divide-y divide-white/[0.05]">
                  {beat.sources.map((source) => {
                    const Icon = SOURCE_ICON[source.kind];
                    return (
                      <li
                        key={source.at}
                        className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-3"
                      >
                        <span className="flex shrink-0 items-center gap-1.5 text-accent">
                          <Icon aria-hidden className="size-3.5" />
                          {source.at}
                        </span>
                        <span className="text-body">{source.fact}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <>
                <p className="mh-eyebrow">Not in your material</p>
                <p className="mh-source text-muted">
                  Nothing you brought mentions a data processing agreement.
                </p>
                <p className="mh-source text-faint">
                  So there's no answer here to read.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="mh-answer space-y-3">
            <p className="mh-eyebrow">From your material</p>
            <p className={`mh-source ${phase === "searching" ? "mh-scan text-accent" : "text-faint"}`}>
              {phase === "searching"
                ? "Searching 1,204 chunks across 38 files…"
                : "Waiting for a question."}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
        {BEATS.map((item, i) => (
          <span
            key={`${item.session}-${item.asked}`}
            aria-hidden
            className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
              i === index ? "bg-accent" : "bg-white/10"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The film. Browsers only allow autoplay while muted, so a scored video plays
 * silently by default and the visitor has no way to know there is anything to
 * hear — hence the explicit control below, which is the only affordance that
 * reliably gets the sound turned on. A visitor who asked for less motion keeps
 * the poster frame instead.
 */
function DemoVideo() {
  const reduced = useReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    if (reduced) video.current?.pause();
  }, [reduced]);

  function toggleSound() {
    const element = video.current;
    if (!element) return;
    const next = !element.muted;
    element.muted = next;
    setMuted(next);
    // Turning the sound on mid-loop drops you into the middle of a beat, so the
    // film restarts from the top the first time.
    if (!next) {
      element.currentTime = 0;
      void element.play();
    }
  }

  return (
    <div className="mh-panel mh-card relative overflow-hidden">
      <video
        ref={video}
        className="block aspect-video w-full"
        src="/demo/meethint-demo.mp4"
        poster="/demo/meethint-demo-poster.jpg"
        preload="metadata"
        autoPlay
        muted
        loop
        playsInline
        controls
      />
      <button
        type="button"
        onClick={toggleSound}
        // Clear of the native control bar at the bottom of the frame.
        className="mh-chip absolute top-3 right-3 hover:text-fg"
        aria-pressed={!muted}
      >
        {muted ? (
          <>
            <VolumeX aria-hidden className="size-3.5 text-accent" />
            Sound off — turn it on
          </>
        ) : (
          <>
            <Volume2 aria-hidden className="size-3.5 text-accent" />
            Sound on
          </>
        )}
      </button>
    </div>
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
      // "You're on the list" is only shown once the row is actually stored.
      // Confirming before that is how a waitlist quietly loses every signup.
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
      <p className="flex items-center gap-2 text-sm text-accent" role="status">
        <Check aria-hidden className="size-4" />
        You're on the list. We'll be in touch before the first calls go live.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor={id}>
          Email address
        </label>
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          className="mh-field sm:flex-1"
          placeholder="Enter your email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (state === "error") setState("idle");
          }}
        />
        <button type="submit" className="mh-cta inline-flex items-center justify-center gap-2" disabled={!valid || state === "sending"}>
          {state === "sending" ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <ArrowRight aria-hidden className="size-4" />
          )}
          Join the private beta
        </button>
      </div>
      {state === "error" ? (
        <p className="text-xs text-bad" role="alert">
          That didn't go through. Try again in a moment.
        </p>
      ) : (
        <p className="text-xs text-faint">No spam, no sharing. One note when the beta opens.</p>
      )}
    </form>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="mh-eyebrow">{children}</span>
      <span className="mh-rule flex-1" />
    </div>
  );
}

export function MeetHintLanding() {
  return (
    <div className="mh-page min-h-dvh text-fg">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <header className="flex items-center justify-between gap-4 py-6">
          <div className="flex items-center gap-2.5">
            <MeetHintMark className="size-7" />
            <span className="brand-word text-sm">MEETHINT</span>
          </div>
          <span className="mh-chip">
            <span className="live-dot inline-block size-1.5 rounded-full bg-accent" />
            Coming soon
          </span>
        </header>

        <main>
          {/* Hero */}
          <section className="grid items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:py-16">
            <div className="mh-rise space-y-7">
              <p className="mh-eyebrow">Live retrieval over your own material</p>
              <h1 className="mh-display space-y-2">
                <span className="block text-2xl text-body sm:text-3xl">
                  Your files stay the source of truth.
                </span>
                <span className="block text-4xl sm:text-5xl">
                  The meeting just became searchable.
                </span>
              </h1>
              <p className="mh-lede max-w-xl">
                They asked about checkout recovery. You last touched that service in March. MeetHint
                finds the note, the PR, and the line — while they're still talking.
              </p>
              <div className="max-w-lg pt-1">
                <WaitlistForm id="hero-email" />
              </div>
              <p className="flex items-center gap-2 text-xs text-faint">
                <ShieldCheck aria-hidden className="size-3.5" />
                Nothing is generated. Every line comes from a file you brought.
              </p>
            </div>
            <div className="mh-rise lg:pl-4">
              <DemoCard />
            </div>
          </section>

          {/* Demo */}
          <section className="space-y-6 py-14">
            <SectionLabel>A session, end to end</SectionLabel>
            <DemoVideo />
            <p className="text-xs text-faint">
              Forty-three seconds, scored. It starts muted because browsers insist — the
              sound is worth turning on.
            </p>
          </section>

          {/* Institutional memory */}
          <section className="space-y-8 py-14">
            <SectionLabel>What it's for</SectionLabel>
            <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:gap-16">
              <div className="space-y-5">
                <h2 className="mh-display text-3xl sm:text-4xl">
                  You can't hold forty repositories in working memory.
                </h2>
                <p className="text-body">
                  Someone asks about a service you shipped fourteen months ago. You shouldn't be
                  flipping through Confluence while the room waits. MeetHint pulls the function, the
                  ADR and the incident note, and puts the citation in front of you.
                </p>
                <p className="text-body">
                  It won't write your sentence for you. And when your material doesn't cover the
                  question, you get silence rather than a guess.
                </p>
              </div>
              <ol className="space-y-3">
                {[
                  { icon: FolderOpen, step: "Bring the material", body: "A repository, a folder of ADRs, a contract, a deck — or all of them at once." },
                  { icon: Mic, step: "It follows the conversation", body: "MeetHint catches the question actually being asked and searches on the spot." },
                  { icon: Quote, step: "It cites, you talk", body: "You get the file and the line it came from. The words are still yours." },
                ].map((item, i) => (
                  <li key={item.step} className="mh-tile flex gap-4 p-4 sm:p-5">
                    <span className="mh-eyebrow pt-0.5 tabular-nums">{`0${i + 1}`}</span>
                    <div className="min-w-0 space-y-1">
                      <p className="flex items-center gap-2 font-medium text-fg">
                        <item.icon aria-hidden className="size-4 text-accent" />
                        {item.step}
                      </p>
                      <p className="text-sm text-muted">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* Material types */}
          <section className="space-y-6 py-14">
            <SectionLabel>Bring anything</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {MATERIAL.map((item) => (
                <span key={item.label} className="mh-chip">
                  <item.icon aria-hidden className="size-3.5 text-accent" />
                  {item.label}
                </span>
              ))}
              <span className="mh-chip border-dashed">Google Docs, Notion, Confluence — later</span>
            </div>
          </section>

          {/* Use cases */}
          <section className="space-y-8 py-14">
            <SectionLabel>Any room</SectionLabel>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {USE_CASES.map((item) => (
                <div key={item.title} className="mh-tile space-y-4 p-5">
                  <p className="flex items-center gap-2.5 font-medium text-fg">
                    <item.icon aria-hidden className="size-4 text-accent" />
                    {item.title}
                  </p>
                  <ul className="space-y-1.5 text-sm text-muted">
                    {item.bring.map((thing) => (
                      <li key={thing} className="flex items-center gap-2">
                        <span aria-hidden className="size-1 rounded-full bg-gutter" />
                        {thing}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {/* Sits in the grid as the sixth cell, in place of a sixth use case. */}
              <div className="mh-panel flex flex-col justify-center gap-2 p-5">
                <p className="mh-display text-2xl">Your files.</p>
                <p className="mh-display text-2xl italic text-accent">Their questions.</p>
                <p className="mh-display text-2xl">Your answer.</p>
              </div>
            </div>
          </section>

          {/* Close */}
          <section className="py-14">
            <div className="mh-panel space-y-7 p-6 sm:p-10">
              <div className="space-y-4">
                <h2 className="mh-display text-3xl sm:text-4xl">
                  Search that can keep up with speech.
                </h2>
                <p className="mh-lede max-w-2xl">
                  Bring the material once. MeetHint stays with the conversation and cites what it
                  finds before the room moves on.
                </p>
              </div>
              <div className="max-w-lg">
                <WaitlistForm id="close-email" />
              </div>
            </div>
          </section>
        </main>

        <footer className="flex flex-col gap-2 border-t border-white/[0.06] py-8 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>meethint.ai — coming soon</span>
          <span>Private beta · indexed on your machine</span>
        </footer>
      </div>
    </div>
  );
}
