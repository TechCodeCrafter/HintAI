import type { CSSProperties, ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { MeetHintMark } from "@/components/meethint-mark";
import { eyebrow, T } from "./theme";

const CITE = T.accent;

export const ease = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

export function Fade({ duration, children }: { duration: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 5, duration - 5, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <div style={{ position: "absolute", inset: 0, opacity }}>{children}</div>;
}

export function Stage({ children, pad }: { children: ReactNode; pad?: number }) {
  const { width } = useVideoConfig();
  return (
    <div
      style={
        {
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "center",
          padding: pad ?? Math.round(width * 0.028),
          fontFamily: T.mono,
          color: T.fg,
          background:
            "radial-gradient(80% 70% at 20% 0%, rgba(47,107,247,0.08), transparent 55%), radial-gradient(70% 60% at 90% 10%, rgba(138,79,240,0.07), transparent 50%), #07090c",
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
        fontSize: 20,
        letterSpacing: "0.08em",
        color: T.fg,
        opacity: show ? 1 : 0,
      }}
    >
      {children}
    </span>
  );
}

function isSocial() {
  const { width, height } = useVideoConfig();
  return height >= width;
}

function typeChars(frame: number, start: number, per: number, text: string) {
  const n = Math.max(0, Math.floor((frame - start) / per));
  return text.slice(0, Math.min(text.length, n));
}

function Cursor({ x, y, down = false }: { x: number; y: number; down?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 16,
        height: 22,
        background: T.fg,
        clipPath: "polygon(0 0, 100% 62%, 42% 62%, 58% 100%, 42% 100%, 28% 62%, 0 62%)",
        transform: `scale(${down ? 0.82 : 1})`,
        filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.55))",
        zIndex: 30,
        pointerEvents: "none",
      }}
    />
  );
}

function Panel({
  label,
  status,
  active = false,
  children,
}: {
  label: string;
  status?: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        borderRadius: 14,
        border: `1px solid ${T.line}`,
        background: "linear-gradient(180deg, rgba(255,255,255,0.038), rgba(255,255,255,0.016))",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow: active ? `inset 3px 0 0 ${T.accent}` : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "11px 14px",
          borderBottom: `1px solid ${T.hairline}`,
        }}
      >
        <span style={{ fontSize: 15, color: T.fg }}>{label}</span>
        <span style={{ fontSize: 13, color: T.faint }}>{status}</span>
      </div>
      <div style={{ padding: 14, flex: 1, minHeight: 0, overflow: "hidden" }}>{children}</div>
    </div>
  );
}

function CockpitShell({
  pack,
  listening = false,
  note,
  children,
  overlay = false,
}: {
  pack: string;
  listening?: boolean;
  note: string;
  children: ReactNode;
  overlay?: boolean;
}) {
  const frame = useCurrentFrame();
  const pulse = 0.45 + 0.55 * Math.sin(frame * 0.35);
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 1680,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 6px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Wordmark size={28} />
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: listening ? T.accent : T.faint,
              boxShadow: listening ? `0 0 10px rgba(${T.accentRgb}, ${pulse})` : undefined,
            }}
          />
          <span style={{ fontSize: 14, color: listening ? T.accent : T.faint }}>
            {listening ? "Listening" : "Idle"}
          </span>
          <span style={{ fontSize: 14, color: T.muted, fontStyle: "italic" }}>{note}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: `1px solid ${T.line}`,
              fontSize: 14,
              color: T.body,
            }}
          >
            {listening ? "Stop listen" : "Listen"}
          </span>
          <span
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: `1px solid ${T.line}`,
              fontSize: 14,
              color: T.fg,
              background: overlay ? "rgba(139,123,245,0.12)" : "rgba(255,255,255,0.03)",
            }}
          >
            Open folder
          </span>
          <span style={{ fontSize: 14, color: T.muted }}>{pack}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

const PACK_FILES = [
  "lecture-04-notes.md",
  "Lecture-4-Networking.pdf",
  "week-4-slides.pdf",
  "contract-amendment-v2.pdf",
  "MSA-v3.pdf",
  "src/exporter/retry.ts",
  "src/auth/handler.ts",
  "lab-02.pdf",
  "project-brief.md",
  "load-test.md",
];

function FileList({ shown, active }: { shown: number; active?: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div>
      {PACK_FILES.slice(0, shown).map((file, i) => {
        const enter = spring({ frame: frame - i * 7, fps, config: { damping: 15, mass: 0.55 } });
        const on = file === active;
        return (
          <div
            key={file}
            style={{
              height: 32,
              display: "flex",
              alignItems: "center",
              padding: "0 8px",
              borderRadius: 6,
              background: on ? "rgba(139,123,245,0.12)" : "transparent",
              boxShadow: on ? `inset 2px 0 0 ${T.accent}` : undefined,
              opacity: enter,
              transform: `translateX(${interpolate(enter, [0, 1], [-16, 0])}px)`,
            }}
          >
            <span style={{ fontSize: 14, color: on ? T.fg : T.muted }}>{file}</span>
          </div>
        );
      })}
    </div>
  );
}

function CodeView({ lines, from, hi }: { lines: string[]; from: number; hi?: [number, number] }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ marginTop: 10 }}>
      {lines.map((line, i) => {
        const n = from + i;
        const on = hi ? n >= hi[0] && n <= hi[1] : false;
        const wipe = on ? ease(frame, 8, 20) : 0;
        return (
          <div
            key={n}
            style={{
              display: "flex",
              gap: 10,
              padding: "3px 6px",
              background: on ? `rgba(139,123,245,${0.14 * wipe})` : "transparent",
            }}
          >
            <span style={{ width: 22, color: T.faintest, fontSize: 13 }}>{n}</span>
            <span style={{ color: on ? T.fg : T.body, fontSize: 13, whiteSpace: "pre" }}>{line}</span>
          </div>
        );
      })}
    </div>
  );
}

function SearchBar({ typed, query, pressed }: { typed: string; query: string; pressed: boolean }) {
  return (
    <div>
      <p style={{ ...eyebrow, margin: 0, fontSize: 12, letterSpacing: "0.12em" }}>Question</p>
      <div
        style={{
          marginTop: 8,
          borderRadius: 8,
          border: `1px solid ${T.line}`,
          background: "rgba(255,255,255,0.03)",
          padding: "10px 12px",
          minHeight: 52,
          fontFamily: T.serif,
          fontSize: 22,
          color: T.fg,
        }}
      >
        {typed}
        <span style={{ color: T.faint }}>{typed.length >= query.length ? "" : "▍"}</span>
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <span
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            border: `1px solid ${T.line}`,
            background: pressed ? "rgba(139,123,245,0.2)" : "rgba(255,255,255,0.04)",
            fontSize: 14,
            color: T.fg,
            transform: `scale(${pressed ? 0.96 : 1})`,
          }}
        >
          Search
        </span>
      </div>
    </div>
  );
}

function ProductCard({
  searching,
  say,
  cite,
  empty,
  appear,
}: {
  searching?: boolean;
  say?: string;
  cite?: string;
  empty?: boolean;
  appear: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame: frame - 4, fps, config: { damping: 14, mass: 0.7 } });
  const scan = (frame % 40) / 40;
  if (searching) {
    return (
      <div>
        <p style={{ ...eyebrow, margin: 0, fontSize: 12 }}>Card</p>
        <p style={{ margin: "16px 0 0", fontFamily: T.serif, fontSize: 20, color: T.muted }}>Searching the pack…</p>
        <div style={{ marginTop: 16, height: 3, borderRadius: 99, background: T.hairline, overflow: "hidden" }}>
          <div
            style={{
              width: "36%",
              height: "100%",
              background: T.accent,
              transform: `translateX(${interpolate(scan, [0, 1], [-40, 220])}%)`,
            }}
          />
        </div>
      </div>
    );
  }
  if (!appear) {
    return (
      <p style={{ fontFamily: T.serif, fontSize: 20, fontStyle: "italic", color: T.body }}>
        Room is the transcript. A question about this pack becomes You say.
      </p>
    );
  }
  if (empty) {
    return (
      <div style={{ opacity: rise, transform: `translateY(${interpolate(rise, [0, 1], [18, 0])}px)` }}>
        <p style={{ fontFamily: T.serif, fontSize: 24, fontStyle: "italic", color: T.body }}>
          Nothing in this pack cites that.
        </p>
      </div>
    );
  }
  return (
    <div style={{ opacity: rise, transform: `translateY(${interpolate(rise, [0, 1], [18, 0])}px)` }}>
      <p style={{ ...eyebrow, margin: 0, fontSize: 12 }}>You say · Say this</p>
      <p style={{ margin: "12px 0 0", fontFamily: T.serif, fontSize: 24, lineHeight: 1.35, color: T.fg }}>{say}</p>
      <div
        style={{
          marginTop: 16,
          borderRadius: 8,
          border: `1px solid ${T.line}`,
          padding: "10px 12px",
        }}
      >
        <p style={{ margin: 0, fontSize: 15, color: CITE }}>{cite}</p>
      </div>
    </div>
  );
}

const CASES = {
  student: {
    query: "three failure modes tcp",
    heard: "Can anyone tell me the three failure modes of the TCP handshake?",
    say: "Connection refused, timeout, and reset. Page 12 of the lecture notes.",
    cite: "Lecture-4-Networking.pdf:12",
    file: "Lecture-4-Networking.pdf",
    lines: ["Handshake completes only on ACK.", "Failure modes:", "Connection refused, timeout, and RST."],
    from: 10,
    hi: [12, 12] as [number, number],
  },
  lawyer: {
    query: "SLA amendment 60 days",
    heard: "The contract says 30-day SLA.",
    say: "Actually — Amendment B, Section 3. Sixty days. March 15. Page 8.",
    cite: "contract-amendment-v2.pdf:8",
    file: "contract-amendment-v2.pdf",
    lines: ["Amendment B", "Section 3. Service levels.", "SLA extended to 60 days effective March 15."],
    from: 6,
    hi: [8, 8] as [number, number],
  },
  engineer: {
    query: "why retry cap at three",
    heard: "Why does the retry logic cap at three?",
    say: "The gateway stalls rather than failing fast. A fourth attempt duplicates the file. Line 4.",
    cite: "src/exporter/retry.ts:4-6",
    file: "src/exporter/retry.ts",
    lines: ["const MAX_ATTEMPTS = 3;", "export function settle(file) {", "  for (let i = 0; i < MAX_ATTEMPTS; i++) {", "    if (await push(file)) return;", "  }"],
    from: 1,
    hi: [4, 6] as [number, number],
  },
};

function SceneSearch({
  name,
  empty = false,
}: {
  name: keyof typeof CASES;
  empty?: boolean;
}) {
  const frame = useCurrentFrame();
  const social = isSocial();
  const pack = CASES[name];
  const query = empty ? "can we handle Stripe webhooks" : pack.query;
  const typed = typeChars(frame, 4, 2, query);
  const done = typed.length >= query.length;
  const clickAt = empty ? 50 : 54;
  const searchAt = clickAt + 3;
  const cardAt = searchAt + 14;
  const searching = done && frame >= searchAt && frame < cardAt;
  const appear = frame >= cardAt;
  const pressed = frame >= clickAt && frame < clickAt + 8;
  const cursorX = interpolate(frame, [done ? clickAt - 16 : 0, clickAt], [social ? 220 : 980, social ? 90 : 760], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cursorY = interpolate(frame, [done ? clickAt - 16 : 0, clickAt], [social ? 360 : 420, social ? 410 : 455], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const columns = social
    ? "1fr"
    : "minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 1fr)";

  return (
    <Stage>
      <CockpitShell pack="the-folder" note={appear ? "Cited from the pack" : "The pack is the brief"}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: columns,
            gap: 16,
            flex: 1,
            minHeight: social ? 720 : 620,
          }}
        >
          {social ? null : (
            <Panel label="Repo" status="10 files" active={appear && !empty}>
              <FileList shown={10} active={appear && !empty ? pack.file : undefined} />
              {appear && !empty ? <CodeView lines={pack.lines} from={pack.from} hi={pack.hi} /> : null}
            </Panel>
          )}
          <Panel label="Room" status="Search" active={!appear}>
            <p style={{ ...eyebrow, margin: "0 0 8px", fontSize: 12 }}>They said</p>
            <p style={{ margin: 0, fontFamily: T.serif, fontSize: 18, color: T.body }}>
              {empty ? "Can we also handle Stripe webhooks?" : pack.heard}
            </p>
            <div style={{ marginTop: 16 }}>
              <SearchBar typed={typed} query={query} pressed={pressed} />
            </div>
          </Panel>
          <Panel label="Card" status={appear ? (empty ? "Silent" : "Found · 48 ms") : "Idle"} active={appear}>
            <ProductCard
              searching={searching}
              appear={appear}
              empty={empty}
              say={pack.say}
              cite={pack.cite}
            />
          </Panel>
        </div>
      </CockpitShell>
      <Cursor x={cursorX} y={cursorY} down={pressed} />
    </Stage>
  );
}

const TABS = [
  "syllabus.pdf",
  "Amendment B",
  "Gmail",
  "retry.ts",
  "Drive",
  "Canvas",
  "Slack",
  "Lecture 4",
  "MSA v3",
  "Notes",
  "Notion",
  "Chat",
];

export function SceneHook() {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 200], [80, 1180], { extrapolateRight: "clamp" });
  const down = frame % 28 < 4;
  return (
    <Stage>
      <div style={{ width: "100%", maxWidth: 1680, alignSelf: "center" }}>
        <div
          style={{
            borderRadius: 16,
            border: `1px solid ${T.line}`,
            background: T.panelSolid,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 0,
              borderBottom: `1px solid ${T.hairline}`,
              overflow: "hidden",
            }}
          >
            {TABS.map((tab, i) => {
              const on = Math.floor(frame / 16) % TABS.length === i;
              return (
                <div
                  key={tab}
                  style={{
                    flex: "0 0 auto",
                    padding: "14px 16px",
                    fontSize: 15,
                    color: on ? T.fg : T.faint,
                    borderRight: `1px solid ${T.hairline}`,
                    background: on ? "rgba(255,255,255,0.04)" : "transparent",
                  }}
                >
                  {tab}
                </div>
              );
            })}
          </div>
          <div style={{ height: 280, position: "relative", background: T.bg }}>
            <p
              style={{
                position: "absolute",
                left: 28,
                top: 28,
                fontFamily: T.serif,
                fontSize: 28,
                color: T.body,
                opacity: ease(frame, 8, 22),
              }}
            >
              12 tabs. The room is waiting.
            </p>
            <Cursor x={x} y={148} down={down} />
          </div>
        </div>
      </div>
    </Stage>
  );
}

export function SceneLoad() {
  const frame = useCurrentFrame();
  const opened = frame >= 18;
  const shown = opened ? Math.min(PACK_FILES.length, Math.floor((frame - 18) / 6) + 1) : 0;
  const cursorX = interpolate(frame, [0, 16], [1180, 1320], { extrapolateRight: "clamp" });
  const cursorY = interpolate(frame, [0, 16], [80, 28], { extrapolateRight: "clamp" });
  const down = frame >= 16 && frame < 24;
  return (
    <Stage>
      <CockpitShell
        pack={opened ? "the-folder" : "No pack"}
        note={opened ? `${shown} files · nothing uploaded` : "Open a local folder to cite your repo."}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isSocial() ? "1fr" : "minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 1fr)",
            gap: 16,
            minHeight: 620,
          }}
        >
          <Panel label="Repo" status={opened ? `${shown} files` : "Empty"} active={opened}>
            {opened ? (
              <FileList shown={shown} />
            ) : (
              <p style={{ fontFamily: T.serif, fontSize: 22, fontStyle: "italic", color: T.body }}>
                Open a local folder to cite your repo.
              </p>
            )}
          </Panel>
          {isSocial() ? null : (
            <>
              <Panel label="Room" status="Idle">
                <p style={{ fontFamily: T.serif, fontSize: 18, fontStyle: "italic", color: T.body }}>
                  Press Listen, then share the call tab with audio.
                </p>
              </Panel>
              <Panel label="Card" status="Idle">
                <p style={{ fontFamily: T.serif, fontSize: 18, fontStyle: "italic", color: T.body }}>
                  A question about this pack becomes You say.
                </p>
              </Panel>
            </>
          )}
        </div>
      </CockpitShell>
      <Cursor x={cursorX} y={cursorY} down={down} />
    </Stage>
  );
}

export function SceneStudent() {
  return <SceneSearch name="student" />;
}
export function SceneLawyer() {
  return <SceneSearch name="lawyer" />;
}
export function SceneEngineer() {
  return <SceneSearch name="engineer" />;
}
export function SceneAsk() {
  return <SceneSearch name="student" />;
}
export function SceneEmpty() {
  return <SceneSearch name="engineer" empty />;
}

export function ScenePromise() {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <CockpitShell pack="the-folder" note="Cite or silence">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isSocial() ? "1fr" : "minmax(0, 1fr) minmax(0, 1.15fr)",
            gap: 16,
            minHeight: 620,
          }}
        >
          <Panel label="Room" status="Search">
            <p style={{ ...eyebrow, margin: "0 0 8px", fontSize: 12 }}>They said</p>
            <p style={{ margin: 0, fontFamily: T.serif, fontSize: 22, color: T.body }}>
              Can we also handle Stripe webhooks?
            </p>
            <div style={{ marginTop: 16 }}>
              <SearchBar typed="can we handle Stripe webhooks" query="can we handle Stripe webhooks" pressed={false} />
            </div>
          </Panel>
          <Panel label="Card" status="Silent" active>
            <ProductCard appear empty />
            <p
              style={{
                margin: "28px 0 0",
                fontFamily: T.serif,
                fontSize: 32,
                color: T.fg,
                opacity: ease(frame, 20, 40),
              }}
            >
              Cite or silence.
            </p>
          </Panel>
        </div>
      </CockpitShell>
    </Stage>
  );
}

const AUDIT = [
  { mark: "#5aa87a", claim: "SLA is 60 days", status: "Supported", cite: "contract-amendment-v2.pdf:8" },
  { mark: "#5aa87a", claim: "Retry capped at 3", status: "Supported", cite: "src/exporter/retry.ts:4-6" },
  { mark: "#c4a35a", claim: "Stripe webhooks", status: "Unverified", cite: "—" },
  { mark: "#c45c5c", claim: "Auth handles 10k RPS", status: "Contradicted", cite: "load-test.md:19" },
];

export function SceneAudit() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slide = spring({ frame: frame - 8, fps, config: { damping: 16, mass: 0.8 } });
  return (
    <Stage>
      <CockpitShell pack="the-folder" note="After the call">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isSocial() ? "1fr" : "minmax(0, 0.9fr) minmax(0, 1.2fr)",
            gap: 16,
            minHeight: 620,
          }}
        >
          <Panel label="Card" status="Last cite">
            <ProductCard appear say={CASES.engineer.say} cite={CASES.engineer.cite} />
          </Panel>
          <div style={{ opacity: slide, transform: `translateX(${interpolate(slide, [0, 1], [80, 0])}px)` }}>
            <Panel label="Claim monitor" status="4 claims">
              {AUDIT.map((row, i) => {
                const enter = spring({
                  frame: frame - (24 + i * 16),
                  fps,
                  config: { damping: 14, mass: 0.55 },
                });
                return (
                  <div
                    key={row.claim}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "14px 1.1fr 0.7fr",
                      gap: 10,
                      alignItems: "center",
                      padding: "12px 4px",
                      borderBottom: `1px solid ${T.hairline}`,
                      opacity: enter,
                      transform: `translateY(${interpolate(enter, [0, 1], [14, 0])}px)`,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: row.mark }} />
                    <div>
                      <p style={{ margin: 0, fontFamily: T.serif, fontSize: 18, color: T.fg }}>{row.claim}</p>
                      <p style={{ margin: "4px 0 0", fontSize: 13, color: T.muted }}>{row.cite}</p>
                    </div>
                    <p style={{ margin: 0, fontSize: 14, color: T.body }}>{row.status}</p>
                  </div>
                );
              })}
            </Panel>
          </div>
        </div>
      </CockpitShell>
    </Stage>
  );
}

export function SceneLive() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dock = spring({ frame: frame - 10, fps, config: { damping: 15, mass: 0.7 } });
  const wave = 0.3 + 0.45 * Math.abs(Math.sin(frame * 0.2));
  const heard = typeChars(frame, 20, 2, "why does the retry logic cap at three");
  return (
    <Stage>
      <div style={{ width: "100%", maxWidth: 1680 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
          <Keycap show={frame >= 4}>L Listen</Keycap>
          <Keycap show={frame >= 16}>O Overlay</Keycap>
        </div>
        <CockpitShell pack="the-folder" listening note="Hearing the call" overlay>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isSocial() ? "1fr" : "minmax(0, 0.42fr) minmax(0, 0.58fr)",
              gap: 16,
              minHeight: 560,
              opacity: dock,
            }}
          >
            <Panel label="Room" status="Live" active>
              <div
                style={{
                  height: 4,
                  borderRadius: 99,
                  background: T.hairline,
                  overflow: "hidden",
                  marginBottom: 16,
                }}
              >
                <div style={{ width: `${wave * 100}%`, height: "100%", background: T.accent }} />
              </div>
              <p style={{ ...eyebrow, margin: "0 0 8px", fontSize: 12 }}>They said</p>
              <p style={{ margin: 0, fontFamily: T.serif, fontSize: 22, color: T.fg }}>
                {heard}
                <span style={{ color: T.accent }}>▍</span>
              </p>
            </Panel>
            <Panel label="Card" status="Auto" active>
              <ProductCard
                appear={frame >= 36}
                say={CASES.engineer.say}
                cite={CASES.engineer.cite}
              />
            </Panel>
          </div>
        </CockpitShell>
      </div>
    </Stage>
  );
}

export function SceneClose() {
  const frame = useCurrentFrame();
  return (
    <Stage pad={80}>
      <div style={{ width: "100%", maxWidth: 1100, textAlign: "center", alignSelf: "center" }}>
        <div style={{ opacity: ease(frame, 2, 12), display: "flex", justifyContent: "center" }}>
          <Wordmark size={48} />
        </div>
        <p
          style={{
            margin: "24px 0 0",
            fontFamily: T.serif,
            fontSize: 36,
            color: T.body,
            opacity: ease(frame, 8, 20),
          }}
        >
          Stop flipping. Stop guessing.
        </p>
        <p
          style={{
            margin: "18px 0 0",
            fontFamily: T.serif,
            fontSize: 40,
            lineHeight: 1.25,
            color: T.fg,
            opacity: ease(frame, 40, 58),
          }}
        >
          Your files are the source of truth.
          <br />
          The meeting just became searchable.
        </p>
      </div>
    </Stage>
  );
}

export function SceneEnd() {
  const frame = useCurrentFrame();
  const form = ease(frame, 8, 22);
  return (
    <Stage pad={80}>
      <div style={{ width: "100%", maxWidth: 1000, textAlign: "center", alignSelf: "center" }}>
        <div style={{ opacity: ease(frame, 2, 12), display: "flex", justifyContent: "center" }}>
          <Wordmark size={52} />
        </div>
        <p
          style={{
            margin: "22px 0 0",
            fontFamily: T.serif,
            fontSize: 28,
            color: T.body,
            opacity: ease(frame, 8, 18),
          }}
        >
          Join the waitlist — free during beta.
        </p>
        <div style={{ margin: "28px auto 0", maxWidth: 620, display: "flex", gap: 10, opacity: form }}>
          <div
            style={{
              flex: 1,
              borderRadius: 10,
              border: `1px solid ${T.line}`,
              padding: "16px 18px",
              textAlign: "left",
              color: T.faint,
              fontSize: 20,
            }}
          >
            you@work.com
          </div>
          <div
            style={{
              borderRadius: 10,
              border: `1px solid ${T.line}`,
              padding: "16px 22px",
              fontSize: 18,
              color: T.fg,
            }}
          >
            Get early access
          </div>
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 16, color: T.faint, opacity: form }}>MeetHint AI</p>
        <p
          style={{
            margin: "28px 0 0",
            fontFamily: T.serif,
            fontSize: 32,
            color: T.body,
            opacity: ease(frame, 70, 90),
          }}
        >
          Cite or silence.
        </p>
      </div>
    </Stage>
  );
}

export function Caption({ text }: { text: string }) {
  const { width } = useVideoConfig();
  if (!text) return null;
  return (
    <div style={{ position: "absolute", left: 40, right: 40, bottom: 48, textAlign: "center" }}>
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
