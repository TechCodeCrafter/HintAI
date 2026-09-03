import type { CSSProperties, ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { MeetHintMark } from "@/components/meethint-mark";
import { eyebrow, T } from "./theme";

/** Accent is reserved for the cited line. Everything else stays off-white. */
const CITE = T.accent;

export const ease = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

export function Fade({ duration, children }: { duration: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 6, duration - 6, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <div style={{ position: "absolute", inset: 0, opacity }}>{children}</div>;
}

export function Stage({
  children,
  desaturate = false,
  pad,
}: {
  children: ReactNode;
  desaturate?: boolean;
  pad?: number;
}) {
  const { width } = useVideoConfig();
  const padding = pad ?? Math.round(width * 0.055);
  return (
    <div
      style={
        {
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding,
          fontFamily: T.mono,
          color: T.fg,
          filter: desaturate ? "grayscale(0.82) contrast(0.92) brightness(0.72)" : undefined,
          "--color-brand-blue": T.brandBlue,
          "--color-brand-violet": T.brandViolet,
          "--color-brand-signal": T.signal,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

export function Wordmark({ size = 44 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.32 }}>
      <MeetHintMark style={{ width: size, height: size }} />
      <span style={{ fontSize: size * 0.48, letterSpacing: "0.28em", fontWeight: 500 }}>MEETHINT</span>
    </div>
  );
}

export function Keycap({ children, show }: { children: ReactNode; show: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "8px 14px",
        borderRadius: 8,
        border: `1px solid ${T.line}`,
        background: "rgba(255,255,255,0.04)",
        fontSize: 22,
        letterSpacing: "0.08em",
        color: T.fg,
        opacity: show ? 1 : 0,
      }}
    >
      {children}
    </span>
  );
}

function Chrome({
  children,
  url = "meethint.ai/app",
  fill = false,
}: {
  children: ReactNode;
  url?: string;
  fill?: boolean;
}) {
  const { width } = useVideoConfig();
  return (
    <div
      style={{
        width: fill ? "100%" : Math.min(1680, width - 80),
        borderRadius: 16,
        border: `1px solid ${T.line}`,
        background: T.panelSolid,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: `1px solid ${T.hairline}`,
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 99, background: "#3d4450" }} />
        <span style={{ width: 10, height: 10, borderRadius: 99, background: "#3d4450" }} />
        <span style={{ width: 10, height: 10, borderRadius: 99, background: "#3d4450" }} />
        <span style={{ marginLeft: 12, fontSize: 16, color: T.faint }}>{url}</span>
      </div>
      {children}
    </div>
  );
}

const PEOPLE = [
  { name: "Jordan", role: "TA", initials: "J", muted: false },
  { name: "Aisha", role: "You", initials: "A", muted: true },
  { name: "Ben", role: "Student", initials: "B", muted: true },
  { name: "Chen", role: "Student", initials: "C", muted: true },
  { name: "Diego", role: "Student", initials: "D", muted: true },
  { name: "Elena", role: "Student", initials: "E", muted: true },
];

export function CallGrid({ speak = 0, compact = false }: { speak?: number; compact?: boolean }) {
  const frame = useCurrentFrame();
  const pulse = 0.55 + 0.45 * Math.sin(frame * 0.28);
  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${T.line}`,
        background: "#0a0d12",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: compact ? "10px 14px" : "12px 18px",
          borderBottom: `1px solid ${T.hairline}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: "#e24b4b",
              boxShadow: "0 0 8px rgba(226,75,75,0.55)",
            }}
          />
          <p style={{ ...eyebrow, margin: 0, fontSize: compact ? 13 : 16 }}>BIO 210 · Office hours</p>
        </div>
        <p style={{ margin: 0, fontSize: compact ? 13 : 16, color: T.faint }}>Zoom · 6</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: compact ? 6 : 8, padding: compact ? 8 : 10 }}>
        {PEOPLE.map((person, i) => {
          const talking = i === speak;
          return (
            <div
              key={person.name}
              style={{
                minHeight: compact ? 92 : 128,
                borderRadius: 10,
                border: talking ? `1px solid rgba(34, 197, 94, ${0.35 + pulse * 0.4})` : `1px solid ${T.hairline}`,
                background: talking ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.025)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                position: "relative",
                boxShadow: talking ? `0 0 0 1px rgba(34,197,94,${0.2 + pulse * 0.25})` : undefined,
              }}
            >
              <div
                style={{
                  width: compact ? 36 : 48,
                  height: compact ? 36 : 48,
                  borderRadius: 99,
                  background: talking ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.08)",
                  color: T.body,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: compact ? 16 : 20,
                }}
              >
                {person.initials}
              </div>
              <p style={{ margin: 0, fontSize: compact ? 12 : 14, color: T.muted }}>
                {person.name}
                <span style={{ color: T.faint }}> · {person.role}</span>
              </p>
              {person.muted && !talking ? (
                <span
                  style={{
                    position: "absolute",
                    left: 8,
                    bottom: 8,
                    fontSize: 11,
                    color: T.faint,
                    letterSpacing: "0.06em",
                  }}
                >
                  MUTE
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {!compact ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 18,
            padding: "10px 0 14px",
            borderTop: `1px solid ${T.hairline}`,
            fontSize: 13,
            letterSpacing: "0.08em",
            color: T.faint,
          }}
        >
          <span>Mute</span>
          <span>Video</span>
          <span>Share</span>
          <span style={{ color: "#c45c5c" }}>Leave</span>
        </div>
      ) : null}
    </div>
  );
}

const TABS = [
  "syllabus.pdf",
  "Lecture 4 notes",
  "Canvas",
  "week-3-slides.pdf",
  "Gmail",
  "Drive",
  "my-notes.txt",
  "curriculum.md",
  "office hours",
  "Chat",
  "Reading list",
  "Lab 02",
];

export function TabBar() {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 110], [40, 720], { extrapolateRight: "clamp" });
  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: `1px solid ${T.hairline}`,
          overflow: "hidden",
        }}
      >
        {TABS.map((tab, i) => (
          <div
            key={tab}
            style={{
              flex: "0 0 auto",
              padding: "14px 16px",
              fontSize: 15,
              color: i === 3 ? T.body : T.faint,
              borderRight: `1px solid ${T.hairline}`,
              background: i === 3 ? "rgba(255,255,255,0.03)" : "transparent",
            }}
          >
            {tab}
          </div>
        ))}
      </div>
      <div style={{ position: "relative", height: 220, background: T.bg }}>
        <div
          style={{
            position: "absolute",
            top: 28,
            left: x,
            width: 14,
            height: 20,
            border: `1px solid ${T.muted}`,
            borderRadius: 2,
            opacity: 0.7,
          }}
        />
      </div>
    </div>
  );
}

function isSocial() {
  const { width, height } = useVideoConfig();
  return height >= width;
}

export function SceneHook() {
  const frame = useCurrentFrame();
  const onTabs = frame >= (isSocial() ? 48 : 110);
  return (
    <Stage desaturate={!onTabs}>
      <div style={{ width: "100%", maxWidth: 1680 }}>
        {!onTabs ? (
          <div style={{ opacity: ease(frame, 0, 14) }}>
            <CallGrid speak={1} />
            <p
              style={{
                margin: "28px 0 0",
                fontFamily: T.serif,
                fontSize: 34,
                color: T.body,
                opacity: ease(frame, 18, 30),
              }}
            >
              “Wait — is the midterm cumulative? What did lecture four actually cover?”
            </p>
          </div>
        ) : (
          <Chrome url="12 tabs · syllabus, notes, Drive, Canvas">
            <TabBar />
          </Chrome>
        )}
      </div>
    </Stage>
  );
}

export function SceneSilence() {
  const frame = useCurrentFrame();
  const onTabs = frame >= (isSocial() ? 48 : 70);
  return (
    <Stage desaturate={!onTabs}>
      <div style={{ width: "100%", maxWidth: 1680 }}>
        {!onTabs ? (
          <div style={{ opacity: ease(frame, 0, 14) }}>
            <CallGrid speak={1} />
            <p
              style={{
                margin: "28px 0 0",
                fontFamily: T.serif,
                fontSize: 34,
                color: T.body,
                opacity: ease(frame, 18, 30),
              }}
            >
              “Wait — is the midterm cumulative? What did lecture four actually cover?”
            </p>
          </div>
        ) : (
          <Chrome url="12 tabs · syllabus, notes, Drive, Canvas">
            <TabBar />
          </Chrome>
        )}
      </div>
    </Stage>
  );
}

const MATERIALS = [
  { name: "syllabus.pdf", kind: "Syllabus" },
  { name: "lecture-04-notes.md", kind: "Lecture" },
  { name: "week-3-slides.pdf", kind: "Slides" },
  { name: "curriculum.md", kind: "Curriculum" },
  { name: "my-notes.txt", kind: "Notes" },
  { name: "office-hours.md", kind: "Notes" },
  { name: "lab-02.pdf", kind: "Lab" },
  { name: "reading-list.md", kind: "Docs" },
];

export function SceneIntro() {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <div style={{ textAlign: "center", opacity: ease(frame, 4, 16) }}>
        <Wordmark size={72} />
        <p style={{ margin: "28px 0 0", fontFamily: T.serif, fontSize: 42, color: T.body }}>
          Introducing MeetHint.
        </p>
      </div>
    </Stage>
  );
}

export function SceneLoad() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const folderIn = spring({ frame, fps, config: { damping: 16, mass: 0.7 } });
  const opened = frame >= 36;
  const readyCount = MATERIALS.filter((_, i) => frame >= 58 + i * 12).length;
  const cursorX = interpolate(frame, [0, 28], [62, 50], { extrapolateRight: "clamp" });
  const cursorY = interpolate(frame, [0, 28], [8, 42], { extrapolateRight: "clamp" });
  return (
    <Stage>
      <div style={{ width: "100%", maxWidth: 1680 }}>
        <Chrome>
          <div style={{ padding: 32, minHeight: 460 }}>
            <p style={{ ...eyebrow, margin: 0 }}>Drop your material</p>
            <p style={{ margin: "10px 0 0", fontFamily: T.serif, fontSize: 28, color: T.body }}>
              Notes, lectures, syllabus, a folder of docs.
            </p>
            <div
              style={{
                marginTop: 22,
                minHeight: 300,
                borderRadius: 12,
                border: `1px dashed ${T.line}`,
                padding: 22,
                position: "relative",
                overflow: "hidden",
              }}
            >
              {!opened ? (
                <div
                  style={{
                    height: 256,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transform: `translateY(${interpolate(folderIn, [0, 1], [-80, 0])}px)`,
                    opacity: folderIn,
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <p style={{ margin: 0, fontFamily: T.serif, fontSize: 48, color: T.fg }}>BIO-210 /</p>
                    <p style={{ margin: "12px 0 0", fontSize: 20, color: T.faint }}>Drop to keep it local</p>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 12,
                  }}
                >
                  {MATERIALS.map((file, i) => {
                    const enter = spring({
                      frame: frame - (38 + i * 10),
                      fps,
                      config: { damping: 14, mass: 0.6 },
                    });
                    const ready = ease(frame, 58 + i * 12, 70 + i * 12);
                    return (
                      <div
                        key={file.name}
                        style={{
                          padding: "16px 14px",
                          borderRadius: 10,
                          border: `1px solid ${T.line}`,
                          background: "rgba(255,255,255,0.03)",
                          opacity: enter,
                          transform: `translateY(${interpolate(enter, [0, 1], [22, 0])}px)`,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <p style={{ ...eyebrow, margin: 0, fontSize: 13, color: T.muted }}>{file.kind}</p>
                          <p style={{ margin: 0, fontSize: 12, color: T.faint, opacity: ready }}>local</p>
                        </div>
                        <p style={{ margin: "8px 0 0", fontSize: 18, color: T.fg }}>{file.name}</p>
                      </div>
                    );
                  })}
                </div>
              )}
              {!opened ? (
                <div
                  style={{
                    position: "absolute",
                    left: `${cursorX}%`,
                    top: `${cursorY}%`,
                    width: 16,
                    height: 22,
                    background: T.fg,
                    clipPath: "polygon(0 0, 100% 62%, 42% 62%, 58% 100%, 42% 100%, 28% 62%, 0 62%)",
                    opacity: 0.85,
                    filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))",
                  }}
                />
              ) : null}
            </div>
            <p
              style={{
                margin: "18px 0 0",
                fontSize: 20,
                color: T.faint,
                opacity: ease(frame, 50, 70),
              }}
            >
              {opened ? `${Math.min(8, readyCount)} files` : "Drop a folder"} · lectures, notes, curriculum · nothing uploaded
            </p>
          </div>
        </Chrome>
      </div>
    </Stage>
  );
}

function typeChars(frame: number, start: number, per: number, text: string) {
  const n = Math.max(0, Math.floor((frame - start) / per));
  return text.slice(0, Math.min(text.length, n));
}

const QUERY = "is the midterm cumulative";
const LINE = "Midterm is cumulative through Lecture 4 (membrane potential, Nernst, AP).";
const SAY =
  "Yes. The midterm is cumulative through lecture 4. Lecture 4 covers membrane potential, the Nernst equation, and how a graded potential becomes an action potential — that's the last unit on the exam.";

export function CitedCard({ appear }: { appear: boolean }) {
  return (
    <div
      style={{
        marginTop: 28,
        borderRadius: 12,
        border: `1px solid ${T.line}`,
        background: "rgba(255,255,255,0.03)",
        padding: "28px 30px",
        opacity: appear ? 1 : 0,
      }}
    >
      <p style={{ ...eyebrow, margin: 0 }}>You say</p>
      <p style={{ margin: "14px 0 0", fontFamily: T.serif, fontSize: 30, lineHeight: 1.35, color: T.fg }}>
        {SAY}
      </p>
      <p style={{ margin: "22px 0 0", fontFamily: T.mono, fontSize: 22, lineHeight: 1.4, color: CITE }}>{LINE}</p>
      <p style={{ margin: "12px 0 0", fontSize: 20, color: T.body }}>lecture-04-notes.md : 18–22</p>
    </div>
  );
}

export function SceneAsk() {
  const frame = useCurrentFrame();
  const social = isSocial();
  const typed = typeChars(frame, social ? 12 : 36, social ? 3 : 4, QUERY);
  const done = typed.length >= QUERY.length;
  const card = frame >= (social ? 70 : 160);
  return (
    <Stage>
      <div style={{ width: "100%", maxWidth: 1680 }}>
        <div style={{ marginBottom: 18, opacity: ease(frame, 0, 10) }}>
          <Keycap show>Ctrl + K</Keycap>
        </div>
        <Chrome>
          <div style={{ padding: 36, minHeight: 440 }}>
            <p style={{ ...eyebrow, margin: 0 }}>Question</p>
            <p
              style={{
                margin: "16px 0 0",
                fontFamily: T.serif,
                fontSize: 44,
                color: T.fg,
                minHeight: 58,
              }}
            >
              {typed}
              <span style={{ color: T.faint }}>{done ? "" : "▍"}</span>
            </p>
            <CitedCard appear={card} />
          </div>
        </Chrome>
      </div>
    </Stage>
  );
}

export function SceneAnswer() {
  const frame = useCurrentFrame();
  return (
    <Stage desaturate>
      <div style={{ width: "100%", maxWidth: 1480 }}>
        <CallGrid speak={1} />
        <p
          style={{
            margin: "32px 0 0",
            fontFamily: T.serif,
            fontSize: 34,
            lineHeight: 1.35,
            color: T.body,
            opacity: ease(frame, 8, 22),
          }}
        >
          “Yes — cumulative through lecture 4. Membrane potential, Nernst, action potentials.”
        </p>
      </div>
    </Stage>
  );
}

const SAML = "is the final open book?";

export function EmptyCard({ appear }: { appear: boolean }) {
  return (
    <div
      style={{
        marginTop: 28,
        height: 168,
        borderRadius: 12,
        border: `1px solid ${T.line}`,
        background: "transparent",
        opacity: appear ? 1 : 0,
      }}
    />
  );
}

export function SceneEmpty() {
  const frame = useCurrentFrame();
  const social = isSocial();
  const typed = typeChars(frame, social ? 4 : 8, social ? 2 : 3, SAML);
  const card = frame >= (social ? 48 : 78);
  return (
    <Stage>
      <div style={{ width: "100%", maxWidth: 1680 }}>
        <Chrome>
          <div style={{ padding: 36, minHeight: 440 }}>
            <p style={{ ...eyebrow, margin: 0 }}>Question</p>
            <p style={{ margin: "16px 0 0", fontFamily: T.serif, fontSize: 44, color: T.fg, minHeight: 58 }}>
              {typed}
              <span style={{ color: T.faint }}>{typed.length >= SAML.length ? "" : "▍"}</span>
            </p>
            <EmptyCard appear={card} />
          </div>
        </Chrome>
      </div>
    </Stage>
  );
}

const LIVE_CARDS = [
  { line: "Midterm is cumulative through lecture 4.", cite: "syllabus.pdf : 12–14" },
  { line: "Lecture 4: membrane potential, Nernst, action potentials.", cite: "lecture-04-notes.md : 18–22" },
  { line: "Office hours do not add new examinable material.", cite: "office-hours.md : 6–8" },
];

export function SceneLive() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dock = spring({ frame: frame - 18, fps, config: { damping: 16, mass: 0.72 } });
  const wave = 0.35 + 0.25 * Math.sin(frame * 0.22);
  return (
    <Stage>
      <div style={{ width: "100%", maxWidth: 1680 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <Keycap show={frame >= 6}>L Listen</Keycap>
          <Keycap show={frame >= 22}>O Overlay</Keycap>
        </div>
        <div style={{ display: "flex", alignItems: "stretch", gap: 18 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <CallGrid speak={0} />
          </div>
          <div
            style={{
              width: 520,
              flexShrink: 0,
              opacity: dock,
              transform: `translateX(${interpolate(dock, [0, 1], [64, 0])}px)`,
            }}
          >
            <Chrome fill>
              <div style={{ padding: 20, minHeight: 360 }}>
                <p style={{ ...eyebrow, margin: "0 0 14px" }}>Listening to the call</p>
                <div
                  style={{
                    height: 4,
                    borderRadius: 99,
                    background: T.hairline,
                    overflow: "hidden",
                    marginBottom: 16,
                  }}
                >
                  <div style={{ width: `${wave * 100}%`, height: "100%", background: T.fg, opacity: 0.35 }} />
                </div>
                {LIVE_CARDS.map((card, i) => (
                  <div
                    key={card.cite}
                    style={{
                      marginBottom: 12,
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: `1px solid ${T.line}`,
                      opacity: ease(frame, 42 + i * 28, 56 + i * 28),
                    }}
                  >
                    <p style={{ margin: 0, fontFamily: T.serif, fontSize: 18, color: CITE }}>{card.line}</p>
                    <p style={{ margin: "8px 0 0", fontSize: 14, color: T.muted }}>{card.cite}</p>
                  </div>
                ))}
              </div>
            </Chrome>
          </div>
        </div>
      </div>
    </Stage>
  );
}

export function SceneTagline() {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36, width: "100%", maxWidth: 1200 }}>
        <div style={{ width: "100%", opacity: ease(frame, 0, 12) }}>
          <CitedCard appear />
        </div>
        <div style={{ opacity: ease(frame, 28, 44), textAlign: "center" }}>
          <Wordmark size={56} />
          <p style={{ margin: "18px 0 0", fontFamily: T.serif, fontSize: 40, color: T.body }}>Cite or silence.</p>
        </div>
      </div>
    </Stage>
  );
}

export function SceneEnd() {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <div style={{ width: "100%", maxWidth: 1100, opacity: ease(frame, 4, 16) }}>
        <Wordmark size={48} />
        <p
          style={{
            margin: "36px 0 0",
            fontFamily: T.serif,
            fontSize: 52,
            lineHeight: 1.2,
            color: T.fg,
          }}
        >
          The file is the source of truth.
          <br />
          The model writes what you say.
        </p>
        <p style={{ margin: "28px 0 0", fontSize: 26, color: T.muted }}>
          If the pack doesn’t have it, the card stays empty.
        </p>
        <p style={{ margin: "48px 0 0", fontSize: 40, letterSpacing: "0.02em", color: T.fg }}>meethint.ai</p>
      </div>
    </Stage>
  );
}

export function Caption({ text }: { text: string }) {
  const { width } = useVideoConfig();
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 40,
        right: 40,
        bottom: 48,
        textAlign: "center",
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: T.serif,
          fontSize: width < 1200 ? 28 : 32,
          lineHeight: 1.3,
          color: T.fg,
          textShadow: "0 1px 12px rgba(0,0,0,0.8)",
        }}
      >
        {text}
      </p>
    </div>
  );
}
