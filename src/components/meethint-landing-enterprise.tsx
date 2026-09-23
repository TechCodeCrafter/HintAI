import { ArrowRight, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MeetHintMark } from "@/components/meethint-mark";
import { MEETHINT_DOMAIN, MEETHINT_MARK, MEETHINT_NAME, MEETHINT_REPO } from "@/lib/brand";
import { demoMediaUrl } from "@/lib/demo-media";
import { useClientMounted } from "@/lib/use-client-mounted";
import { joinWaitlist } from "@/lib/waitlist";
import "@/styles/landing-enterprise-v2.css";
import "@/styles/landing-enterprise-extras.css";

type FormState = "idle" | "sending" | "done" | "error";

const PRIVACY_FAQ = [
  {
    q: "Is audio recorded?",
    a: "MeetHint does not upload or store meeting audio on our servers. Speech is processed on your device for live captions and question detection.",
  },
  {
    q: "Is data stored?",
    a: "Your Knowledge Spaces, indexed chunks, and session history stay in your browser unless you use a signed-in deployment with server-backed storage.",
  },
  {
    q: "Is processing local?",
    a: "Indexing and search run locally. When an answer needs a model, only the retrieved excerpts required for that answer are sent to the provider you configure.",
  },
  {
    q: "How long is data retained?",
    a: "Until you clear site data in your browser or remove a Knowledge Space. We do not keep a copy of your files on MeetHint servers for indexing.",
  },
  {
    q: "Does MeetHint access the screen?",
    a: "No screen capture. On desktop Chrome you can optionally share a meeting tab with audio; otherwise MeetHint uses your microphone.",
  },
] as const;

const PROFESSIONALS = [
  {
    role: "Sales",
    question: "What exactly is included in Enterprise?",
    source: "pricing.pdf · product-overview.pdf",
  },
  {
    role: "Solutions Engineering",
    question: "Do we support Canadian data residency?",
    source: "security-architecture.pdf · §4.2",
  },
  {
    role: "Customer Success",
    question: "What did we promise this customer?",
    source: "implementation-notes.md · §8",
  },
  {
    role: "Security",
    question: "What evidence supports this control?",
    source: "security-review.pdf · p.17",
  },
  {
    role: "Engineering",
    question: "Why was this service designed this way?",
    source: "architecture.md · decision-12",
  },
  {
    role: "Implementation",
    question: "Which requirement changed last week?",
    source: "client-notes.md · Sep 14",
  },
] as const;

const MATERIAL_GROUPS = [
  {
    label: "Code & repos",
    hint: "Search implementation, not just READMEs. Git history is available on the demo pack today.",
    items: [
      { name: "Repositories", ext: "git" },
      { name: "Folders", ext: "dir" },
      { name: "Markdown", ext: "md" },
      { name: "Source code", ext: "ts" },
    ],
  },
  {
    label: "Documents",
    hint: "Page-level citations where supported",
    items: [
      { name: "PDF", ext: "pdf", note: "page limits" },
      { name: "Word", ext: "docx" },
      { name: "PowerPoint", ext: "pptx" },
      { name: "Slides", ext: "ppt" },
    ],
  },
  {
    label: "Spreadsheets & data",
    hint: "Structured answers from tables and exports",
    items: [
      { name: "Excel", ext: "xlsx" },
      { name: "CSV", ext: "csv" },
    ],
  },
] as const;

function WaitlistForm() {
  const mounted = useClientMounted();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");

  useEffect(() => {
    if (window.localStorage.getItem("meethint.waitlist")) setState("done");
  }, []);

  const valid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()), [email]);

  if (!mounted) {
    return (
      <div className="mhv2-waitlist" aria-hidden="true">
        <div className="mhv2-waitlist-input" />
        <div className="mhv2-waitlist-button">Join the private beta</div>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || state === "sending") return;
    setState("sending");
    try {
      const result = await joinWaitlist({ data: { email: email.trim(), source: "hero-email" } });
      if (!result.ok) throw new Error(result.reason);
      window.localStorage.setItem("meethint.waitlist", email.trim());
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="mhv2-waitlist-success" data-testid="waitlist-done" role="status">
        <span>You're on the list. We'll be in touch before the first calls go live.</span>
      </div>
    );
  }

  return (
    <form className="mhv2-waitlist-wrap" onSubmit={submit} noValidate>
      <div className="mhv2-waitlist">
        <label className="sr-only" htmlFor="hero-email">Email address</label>
        <input
          id="hero-email"
          type="email"
          inputMode="email"
          autoComplete="off"
          data-1p-ignore=""
          data-lpignore="true"
          data-testid="hero-email-input"
          className="mhv2-waitlist-input"
          placeholder="Work email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (state === "error") setState("idle");
          }}
        />
        <button
          type="submit"
          data-testid="hero-email-submit"
          className="mhv2-waitlist-button"
          disabled={!valid || state === "sending"}
        >
          {state === "sending" ? "Joining…" : "Join the private beta"}
          {state !== "sending" ? <ArrowRight aria-hidden /> : null}
        </button>
      </div>
      <p className={state === "error" ? "mhv2-form-error" : "mhv2-form-note"}>
        {state === "error" ? "That didn't go through. Try again in a moment." : "No spam. One note when the beta opens."}
      </p>
    </form>
  );
}

function HeroProduct() {
  return (
    <div className="mhv2-product-shell" aria-label="MeetHint cited answer preview">
      <div className="mhv2-product-topbar">
        <div className="mhv2-product-status">
          <span className="mhv2-live-dot" aria-hidden />
          Live session
        </div>
        <span className="mhv2-product-meta">47 files indexed</span>
      </div>

      <div className="mhv2-product-layout">
        <aside className="mhv2-product-sources">
          <div className="mhv2-mini-heading">Sources</div>
          <div className="mhv2-source active">
            <div><strong>security-architecture.pdf</strong><span>42 pages</span></div>
          </div>
          <div className="mhv2-source">
            <div><strong>enterprise-sla.pdf</strong><span>18 pages</span></div>
          </div>
          <div className="mhv2-source">
            <div><strong>architecture.md</strong><span>Repository</span></div>
          </div>
          <div className="mhv2-source">
            <div><strong>customer-contract.pdf</strong><span>31 pages</span></div>
          </div>
        </aside>

        <div className="mhv2-product-room">
          <div className="mhv2-question-bubble">
            <span className="mhv2-question-label">They asked</span>
            <p>“Do we support Canadian data residency?”</p>
          </div>

          <div className="mhv2-answer-card">
            <div className="mhv2-answer-head">
              <span>Answer ready</span>
              <span className="mhv2-time">0.8s</span>
            </div>
            <div className="mhv2-product-signals" aria-hidden="true">
              <span className="mhv2-product-signal">Question detected during the call</span>
              <span className="mhv2-product-signal">Evidence attached automatically</span>
            </div>
            <p className="mhv2-answer-copy">
              Yes. Canadian data residency is available for Enterprise deployments.
            </p>
            <button type="button" className="mhv2-citation">
              <span className="mhv2-verified">Verified</span>
              <span>security-architecture.pdf</span>
              <span>§4.2 · p.17</span>
              <ChevronRight aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <div className="mhv2-product-foot">
        <span>Your material only</span>
        <span>Source attached</span>
        <span>No unsupported fallback</span>
      </div>
    </div>
  );
}

function ProofConsole() {
  return (
    <div className="mhv2-proof-console">
      <div className="mhv2-console-bar">
        <div className="mhv2-console-brand">
          <MeetHintMark className="mhv2-console-mark" />
          <span>MeetHint</span>
        </div>
        <div className="mhv2-console-state"><span /> Answer ready</div>
      </div>
      <div className="mhv2-console-grid">
        <div className="mhv2-console-files">
          <div className="mhv2-console-title">Files</div>
          <div className="selected">MSA.pdf</div>
          <div>addendum.pdf</div>
          <div>pricing.pdf</div>
          <div>notes.md</div>
        </div>
        <div className="mhv2-console-answer">
          <div className="mhv2-console-title">They asked</div>
          <h3>“Does the contract allow automatic renewal?”</h3>
          <p>
            Yes. The agreement renews for successive 12-month periods unless either party provides
            60 days' written notice.
          </p>
          <div className="mhv2-console-cite">
            <span>Verified</span>
            <strong>MSA.pdf</strong>
            <span>§8.2 · p.17</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MeetHintLandingEnterprise() {
  return (
    <div className="mhv2 hint-landing" data-testid="landing">
      <header className="mhv2-nav">
        <div className="mhv2-wrap mhv2-nav-inner">
          <a href="/" className="mhv2-brand" aria-label="MeetHint home">
            <MeetHintMark className="mhv2-brand-mark" />
            <span>{MEETHINT_MARK}</span>
          </a>

          <nav className="mhv2-desktop-nav" aria-label="Primary navigation">
            <a href="#product">Product</a>
            <a href="#professionals">Use cases</a>
            <a href="/security">Security</a>
            <a href="#materials">Sources</a>
          </nav>

          <div className="mhv2-nav-actions">
            <a href="/login" className="mhv2-nav-signin">Sign in</a>
            <a href="/home" className="mhv2-button mhv2-button-primary">
              Try {MEETHINT_MARK}
              <ArrowRight aria-hidden />
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="mhv2-hero">
          <div className="mhv2-hero-glow mhv2-hero-glow-one" aria-hidden />
          <div className="mhv2-hero-glow mhv2-hero-glow-two" aria-hidden />
          <div className="mhv2-wrap mhv2-hero-grid">
            <div className="mhv2-hero-copy">
              <div className="mhv2-pill">
                <span className="mhv2-pill-dot" />
                Answers from the material you trust
              </div>
              <h1>
                Know the answer
                <span>while they're still asking.</span>
              </h1>
              <p className="mhv2-hero-lede">
                {MEETHINT_NAME} listens to the conversation, checks the documents you uploaded,
                and gives you a cited answer in seconds.
              </p>
              <p className="mhv2-hero-secondary">
                If your material doesn't support the answer, it doesn't make one up.
              </p>
              <div className="mhv2-hero-actions">
                <a href="/home" className="mhv2-button mhv2-button-primary mhv2-button-large">
                  Try {MEETHINT_MARK}
                  <ArrowRight aria-hidden />
                </a>
                <a href="#demo" className="mhv2-button mhv2-button-secondary mhv2-button-large">
                  Watch 45 sec demo
                </a>
              </div>
              <div className="mhv2-trust-inline">
                <span>Your files only</span>
                <span>Cited answers</span>
                <span>Quiet when unsupported</span>
              </div>
            </div>

            <div className="mhv2-hero-product">
              <HeroProduct />
            </div>
          </div>
        </section>

        <section className="mhv2-proof-strip">
          <div className="mhv2-wrap mhv2-proof-strip-grid">
            <div>
              <strong>Your material</strong>
              <span>Not the open internet.</span>
            </div>
            <div>
              <strong>Source attached</strong>
              <span>File, section, page.</span>
            </div>
            <div>
              <strong>Permission scoped</strong>
              <span>Search only what you can access.</span>
            </div>
            <div>
              <strong>Silence is valid</strong>
              <span>No evidence, no invented answer.</span>
            </div>
          </div>
        </section>

        <section className="mhv2-social-band" aria-labelledby="social-proof-heading">
          <div className="mhv2-wrap mhv2-social-grid">
            <div className="mhv2-social-copy">
              <p className="mhv2-eyebrow">PRIVATE BETA</p>
              <h2 id="social-proof-heading">Built for developers and engineers in live meetings</h2>
              <p>
                MeetHint is in private beta with sales engineers, customer success teams, and technical
                operators who need cited answers while the conversation is still happening.
              </p>
            </div>
            <ul className="mhv2-social-list">
              <li>
                <strong>Private beta</strong>
                <span>Invite-based access. No inflated public metrics.</span>
              </li>
              <li>
                <strong>Open repository</strong>
                <span>
                  <a href={MEETHINT_REPO} className="mhv2-text-link">
                    View source on GitHub
                  </a>
                </span>
              </li>
              <li>
                <strong>Role-tested workflows</strong>
                <span>Sales, solutions engineering, customer success, and technical support.</span>
              </li>
            </ul>
          </div>
        </section>

        <section id="privacy" className="mhv2-privacy-band" aria-labelledby="privacy-first-heading">
          <div className="mhv2-wrap">
            <div className="mhv2-section-heading mhv2-heading-center">
              <p className="mhv2-eyebrow">PRIVACY FIRST</p>
              <h2 id="privacy-first-heading">Straight answers about your data</h2>
              <p>MeetHint is designed to search material you load, not to hoard your conversations.</p>
            </div>
            <dl className="mhv2-privacy-faq">
              {PRIVACY_FAQ.map(({ q, a }) => (
                <div key={q} className="mhv2-privacy-item">
                  <dt>{q}</dt>
                  <dd>{a}</dd>
                </div>
              ))}
            </dl>
            <p className="mhv2-privacy-more">
              <a href="/privacy" className="mhv2-text-link">
                Read the full privacy policy <ArrowRight aria-hidden />
              </a>
            </p>
          </div>
        </section>

        <section id="product" className="mhv2-section mhv2-how">
          <div className="mhv2-wrap">
            <div className="mhv2-section-heading mhv2-heading-center">
              <p className="mhv2-eyebrow">FROM QUESTION TO PROOF</p>
              <h2>What happens while everyone else is still talking.</h2>
              <p>MeetHint stays in the flow of the meeting instead of becoming another tab you have to search.</p>
            </div>

            <ol className="mhv2-steps">
              <li>
                <span className="mhv2-step-number">01</span>
                <h3>Hear the question</h3>
                <p>MeetHint picks up the question that is actually being asked.</p>
              </li>
              <li>
                <span className="mhv2-step-number">02</span>
                <h3>Search your material</h3>
                <p>It checks the documents, files, and code already loaded into the space.</p>
              </li>
              <li>
                <span className="mhv2-step-number">03</span>
                <h3>Find the evidence</h3>
                <p>MeetHint finds the passage that actually supports the answer.</p>
              </li>
              <li>
                <span className="mhv2-step-number">04</span>
                <h3>Answer with proof</h3>
                <p>You get the line to say with the source attached underneath it.</p>
              </li>
            </ol>
          </div>
        </section>

        <section id="demo" className="mhv2-dark-section">
          <div className="mhv2-wrap">
            <div className="mhv2-dark-heading">
              <p className="mhv2-eyebrow">THE PRODUCT IS THE PROOF</p>
              <h2>A real answer.<br /><span>Backed by your source.</span></h2>
              <p>
                MeetHint does not give you a polished guess. It gives you an answer you can trace
                back to the material your team actually loaded.
              </p>
            </div>

            <ProofConsole />

            <div className="mhv2-demo-video">
              <div className="mhv2-demo-copy">
                <span className="mhv2-demo-kicker">45 SECOND PRODUCT CUT</span>
                <h3>See the moment it finds the answer.</h3>
                <p>One real question. One supported answer. One source you can open.</p>
              </div>
              <div className="mhv2-video-frame">
                <video
                  src={demoMediaUrl("meethint-demo-cutaway.mp4")}
                  poster="/demo/meethint-demo-cutaway-poster.jpg"
                  preload="metadata"
                  playsInline
                  controls
                />
              </div>
            </div>
          </div>
        </section>

        <section id="professionals" className="mhv2-section mhv2-professionals">
          <div className="mhv2-wrap">
            <div className="mhv2-section-heading">
              <p className="mhv2-eyebrow">FOR THE PEOPLE WHO GET THE HARD QUESTIONS</p>
              <h2>Any professional. Their question. Your source.</h2>
              <p>
                The job title changes. The moment does not. Someone asks something specific,
                and the room is waiting for a correct answer.
              </p>
            </div>

            <div className="mhv2-professional-grid">
              {PROFESSIONALS.map((item) => (
                <article className="mhv2-professional-card" key={item.role}>
                  <p className="mhv2-role">{item.role}</p>
                  <p className="mhv2-professional-question">“{item.question}”</p>
                  <div className="mhv2-professional-source">
                    <span>{item.source}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mhv2-refusal-section">
          <div className="mhv2-wrap mhv2-refusal-grid">
            <div className="mhv2-refusal-copy">
              <p className="mhv2-eyebrow">THE EMPTY CARD IS A FEATURE</p>
              <h2>If the answer isn't in your material, MeetHint doesn't invent one.</h2>
              <p>
                A confident hallucination is worse than no answer. MeetHint treats “not supported”
                as a real product state.
              </p>
              <div className="mhv2-refusal-points">
                <span>No general-knowledge fallback</span>
                <span>Search stays inside the allowed space</span>
                <span>Supported answers stay traceable</span>
              </div>
            </div>

            <div className="mhv2-empty-card">
              <div className="mhv2-empty-top">
                <span className="mhv2-empty-state"><span /> No verified answer</span>
                <span>0 sources</span>
              </div>
              <div className="mhv2-empty-content">
                <h3>Your material doesn't cover this.</h3>
                <p>MeetHint couldn't find evidence in the material available to this space.</p>
              </div>
              <div className="mhv2-empty-foot">
                Cite it, or stay silent.
              </div>
            </div>
          </div>
        </section>

        <section id="materials" className="mhv2-section mhv2-materials">
          <div className="mhv2-wrap">
            <div className="mhv2-section-heading">
              <p className="mhv2-eyebrow">BRING THE MATERIAL</p>
              <h2>Bring the material. MeetHint brings it into the conversation.</h2>
              <p>
                Load the sources you already trust. Keep the experience grounded in the same material
                your team uses to do the work.
              </p>
            </div>

            <div className="mhv2-material-board">
              {MATERIAL_GROUPS.map((group) => (
                <section className="mhv2-material-group" key={group.label} aria-label={group.label}>
                  <header className="mhv2-material-group-head">
                    <h3>{group.label}</h3>
                    <p>{group.hint}</p>
                  </header>
                  <ul className="mhv2-material-chips">
                    {group.items.map((item) => (
                      <li key={item.ext}>
                        <span className="mhv2-material-chip">
                          <span className="mhv2-material-chip-ext">{item.ext}</span>
                          <span className="mhv2-material-chip-name">{item.name}</span>
                          {"note" in item && item.note ? (
                            <span className="mhv2-material-chip-note">{item.note}</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </section>

        <section className="mhv2-security-band">
          <div className="mhv2-wrap mhv2-security-grid">
            <div className="mhv2-security-copy">
              <p className="mhv2-eyebrow">BUILT AROUND BOUNDARIES</p>
              <h2>Useful in the room. Disciplined underneath.</h2>
              <p>
                MeetHint searches the material available to the current space, keeps answers tied to evidence,
                and has a first-class unsupported state.
              </p>
              <a href="/security" className="mhv2-text-link">
                Read how MeetHint handles security <ArrowRight aria-hidden />
              </a>
            </div>
            <div className="mhv2-security-cards">
              <article>
                <div><strong>Scoped search</strong><span>Search within the material available to the space.</span></div>
              </article>
              <article>
                <div><strong>Evidence attached</strong><span>See the file and location behind supported answers.</span></div>
              </article>
              <article>
                <div><strong>Unsupported means unsupported</strong><span>No evidence means no fabricated response.</span></div>
              </article>
            </div>
          </div>
        </section>

        <section className="mhv2-final-cta">
          <div className="mhv2-wrap">
            <div className="mhv2-final-card">
              <div className="mhv2-final-copy">
                <p className="mhv2-eyebrow">PUT YOUR KNOWLEDGE IN THE CONVERSATION</p>
                <h2>Know what to say.<br />Know why it's true.</h2>
                <p>Join the private beta and bring your own material into MeetHint.</p>
              </div>
              <div className="mhv2-final-form">
                <WaitlistForm />
                <p className="mhv2-final-tagline">Cite it, or stay silent.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mhv2-footer">
        <div className="mhv2-wrap mhv2-footer-inner">
          <div className="mhv2-footer-brand">
            <div><MeetHintMark className="mhv2-footer-mark" /><strong>{MEETHINT_MARK}</strong></div>
            <span>{MEETHINT_DOMAIN}</span>
          </div>
          <nav data-testid="landing-footer-trust-nav" aria-label="Footer">
            <a href="#product">Product</a>
            <a href="#professionals">Use cases</a>
            <a href="#privacy">Privacy first</a>
            <a href="/privacy">Privacy policy</a>
            <a href="/terms">Terms</a>
            <a href="/security">Security</a>
            <a href="/contact">Contact</a>
          </nav>
          <a href="/home" className="mhv2-footer-open">Open app</a>
        </div>
      </footer>
    </div>
  );
}
