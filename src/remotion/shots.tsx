import type { CSSProperties, ReactNode } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
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

function Chrome({ children, url = "meethint.ai/app" }: { children: ReactNode; url?: string }) {
  const { width } = useVideoConfig();
  return (
    <div
      style={{
        width: Math.min(1680, width - 80),
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
  { name: "Maya", role: "PM", initials: "M" },
  { name: "Alex", role: "Eng", initials: "A" },
  { name: "Priya", role: "Design", initials: "P" },
  { name: "Sam", role: "Eng", initials: "S" },
];

export function CallGrid({ speak = 0 }: { speak?: number }) {
  const { width } = useVideoConfig();
  const tile = Math.min(340, Math.round(width * 0.22));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      {PEOPLE.map((person, i) => (
        <div
          key={person.name}
          style={{
            width: tile,
            height: Math.round(tile * 0.72),
            borderRadius: 12,
            border: `1px solid ${T.line}`,
            background: i === speak ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            transform: i === speak ? "scale(1.03)" : undefined,
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 99,
              background: "rgba(255,255,255,0.08)",
              color: T.body,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
            }}
          >
            {person.initials}
          </div>
          <p style={{ margin: 0, fontSize: 16, color: T.muted }}>
            {person.name} · {person.role}
          </p>
        </div>
      ))}
    </div>
  );
}

const TABS = [
  "auth/handler.ts",
  "auth/token.ts",
  "routes/session.ts",
  "docs/api.md",
  "handlers/refresh.ts",
  "contracts/sso.md",
  "lib/jwt.ts",
  "middleware/auth.ts",
  "tests/auth.spec.ts",
  "README.md",
  "package.json",
  "schema.sql",
  "errors.ts",
  "types.ts",
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
            <p style={{ ...eyebrow, margin: "0 0 22px" }}>Standup · four on the call</p>
            <CallGrid speak={0} />
            <p
              style={{
                margin: "28px 0 0",
                fontFamily: T.serif,
                fontSize: 36,
                color: T.body,
                opacity: ease(frame, 18, 30),
              }}
            >
              “Wait — what does the API return if the token expires?”
            </p>
          </div>
        ) : (
          <Chrome url="localhost:8080 — 14 tabs">
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
            <p style={{ ...eyebrow, margin: "0 0 22px" }}>Standup · four on the call</p>
            <CallGrid speak={0} />
            <p
              style={{
                margin: "28px 0 0",
                fontFamily: T.serif,
                fontSize: 36,
                color: T.body,
                opacity: ease(frame, 18, 30),
              }}
            >
              “Wait — what does the API return if the token expires?”
            </p>
          </div>
        ) : (
          <Chrome url="localhost:8080 — 14 tabs">
            <TabBar />
          </Chrome>
        )}
      </div>
    </Stage>
  );
}

const FILES = [
  "auth/handler.ts",
  "auth/token.ts",
  "handlers/refresh.ts",
  "routes/session.ts",
  "routes/login.ts",
  "contracts/sso.md",
  "docs/api.md",
  "docs/errors.md",
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
  const drop = ease(frame, 8, 28);
  const list = ease(frame, 36, 50);
  const scroll = interpolate(frame, [50, 230], [0, -220], { extrapolateRight: "clamp" });
  return (
    <Stage>
      <div style={{ width: "100%", maxWidth: 1680 }}>
        <Chrome>
          <div style={{ padding: 36, minHeight: 420 }}>
            <p style={{ ...eyebrow, margin: 0 }}>Drop a folder</p>
            <div
              style={{
                marginTop: 22,
                height: 280,
                borderRadius: 12,
                border: `1px dashed ${T.line}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  opacity: 1 - list,
                  transform: `translateY(${interpolate(drop, [0, 1], [-70, 0])}px)`,
                  fontFamily: T.serif,
                  fontSize: 40,
                  color: T.fg,
                }}
              >
                src/
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: 24,
                  opacity: list,
                  transform: `translateY(${scroll}px)`,
                }}
              >
                {FILES.map((file) => (
                  <p key={file} style={{ margin: "0 0 12px", fontSize: 26, color: T.body }}>
                    {file}
                  </p>
                ))}
              </div>
            </div>
            <p
              style={{
                margin: "20px 0 0",
                fontSize: 20,
                color: T.faint,
                opacity: ease(frame, 40, 56),
              }}
            >
              Local only · Nothing uploaded
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

const QUERY = "token expired response";
const LINE = 'return res.status(401).json({ error: "TOKEN_EXPIRED" });';

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
      <p style={{ margin: 0, fontFamily: T.serif, fontSize: 32, lineHeight: 1.35, color: CITE }}>{LINE}</p>
      <p style={{ margin: "18px 0 0", fontSize: 22, color: T.body }}>auth/handler.ts : 142–146</p>
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
          “Returns a 401 with TOKEN_EXPIRED in the body — handler.ts, line 142.”
        </p>
      </div>
    </Stage>
  );
}

const SAML = "do we support SAML?";

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
  { line: 'return res.status(401).json({ error: "TOKEN_EXPIRED" });', cite: "auth/handler.ts : 142–146" },
  { line: "Refresh tokens rotate once. Reuse is a revoke.", cite: "auth/token.ts : 88–91" },
  { line: "Expired access tokens are not retried by the client.", cite: "docs/api.md : 40–43" },
];

export function SceneLive() {
  const frame = useCurrentFrame();
  const overlay = frame >= 150;
  const wave = 0.35 + 0.25 * Math.sin(frame * 0.22);
  return (
    <Stage>
      <div style={{ width: "100%", maxWidth: 1680, position: "relative" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <Keycap show={frame >= 6}>L Listen</Keycap>
          <Keycap show={overlay}>O Overlay</Keycap>
        </div>
        <div
          style={{
            width: overlay ? 620 : "100%",
            marginLeft: overlay ? "auto" : 0,
            transform: overlay ? "translateY(40px)" : undefined,
            transition: "none",
          }}
        >
          <Chrome>
            <div style={{ padding: 28, minHeight: overlay ? 280 : 400 }}>
              <div
                style={{
                  height: 4,
                  borderRadius: 99,
                  background: T.hairline,
                  overflow: "hidden",
                  marginBottom: 22,
                }}
              >
                <div style={{ width: `${wave * 100}%`, height: "100%", background: T.fg, opacity: 0.35 }} />
              </div>
              {LIVE_CARDS.map((card, i) => (
                <div
                  key={card.cite}
                  style={{
                    marginBottom: 14,
                    padding: "14px 16px",
                    borderRadius: 10,
                    border: `1px solid ${T.line}`,
                    opacity: ease(frame, 48 + i * 28, 60 + i * 28),
                  }}
                >
                  <p style={{ margin: 0, fontFamily: T.serif, fontSize: overlay ? 18 : 24, color: CITE }}>
                    {card.line}
                  </p>
                  <p style={{ margin: "8px 0 0", fontSize: overlay ? 14 : 18, color: T.muted }}>{card.cite}</p>
                </div>
              ))}
            </div>
          </Chrome>
        </div>
        {overlay ? (
          <div style={{ position: "absolute", left: 0, top: 80, opacity: 0.45, filter: "grayscale(0.8)" }}>
            <CallGrid speak={0} />
          </div>
        ) : null}
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
      <div style={{ textAlign: "center", opacity: ease(frame, 4, 16) }}>
        <Wordmark size={56} />
        <p style={{ margin: "22px 0 0", fontFamily: T.serif, fontSize: 40, color: T.body }}>Cite or silence.</p>
        <p style={{ margin: "36px 0 0", fontSize: 32, letterSpacing: "0.04em", color: T.fg }}>
          meethint.ai
        </p>
        <p style={{ margin: "16px 0 0", fontFamily: T.serif, fontSize: 26, color: T.muted }}>
          Free to run. Your files never leave your machine.
        </p>
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
