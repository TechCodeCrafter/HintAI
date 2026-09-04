import type { ReactNode } from "react";
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const INK = "#1a1208";
const CREAM = "#f4e7c8";
const ORANGE = "#f4a12c";
const TEAL = "#2a4a4a";

function CartoonStage({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 48,
        background: `radial-gradient(70% 60% at 20% 0%, rgba(244,161,44,0.28), transparent 50%), ${CREAM}`,
        color: INK,
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      {children}
    </div>
  );
}

function Stamp({ text = "CUTAWAY" }: { text?: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slam = spring({ frame, fps, config: { damping: 9, mass: 0.35, stiffness: 220 } });
  return (
    <div
      style={{
        position: "absolute",
        top: 36,
        left: 48,
        transform: `rotate(-8deg) scale(${slam})`,
        background: ORANGE,
        border: `6px solid ${INK}`,
        boxShadow: `7px 7px 0 ${INK}`,
        padding: "10px 18px",
        fontFamily: "Impact, Haettenschweiler, sans-serif",
        fontSize: 34,
        letterSpacing: "0.16em",
        color: INK,
        zIndex: 8,
      }}
    >
      {text}
    </div>
  );
}

function Cast({ file, size }: { file: string; size: number }) {
  return (
    <Img
      src={staticFile(`cast/${file}`)}
      style={{
        width: size,
        height: size,
        objectFit: "cover",
        borderRadius: 10,
        border: `6px solid ${INK}`,
        boxShadow: `8px 8px 0 ${INK}`,
        background: CREAM,
      }}
    />
  );
}

export function SceneCutIntro() {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  return (
    <CartoonStage>
      <div style={{ display: "flex", alignItems: "center", gap: 48, opacity: enter, maxWidth: 1400 }}>
        <Cast file="chen-idle.png" size={420} />
        <div>
          <p style={{ margin: 0, fontFamily: "Impact, Haettenschweiler, sans-serif", fontSize: 22, letterSpacing: "0.2em" }}>
            CS 540 · NETWORK PROTOCOLS
          </p>
          <p style={{ margin: "12px 0 0", fontSize: 72, lineHeight: 0.95 }}>Dr. Chen</p>
          <p style={{ margin: "18px 0 0", fontSize: 30, color: TEAL }}>He wrote the textbook.</p>
        </div>
      </div>
    </CartoonStage>
  );
}

export function SceneCutAsk() {
  const frame = useCurrentFrame();
  const panic = frame >= 78;
  return (
    <CartoonStage>
      <Stamp text="THAT ONE STUDENT" />
      <div style={{ width: "100%", maxWidth: 1500 }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 36 }}>
          <div style={{ textAlign: "center" }}>
            <Cast file={panic ? "chen-panic.png" : "chen-idle.png"} size={320} />
            <p style={{ margin: "12px 0 0", fontSize: 22 }}>Dr. Chen</p>
          </div>
          <div style={{ textAlign: "center" }}>
            <Cast file="jessica.png" size={320} />
            <p style={{ margin: "12px 0 0", fontSize: 22 }}>Jessica</p>
          </div>
        </div>
        <p
          style={{
            margin: "36px 0 0",
            textAlign: "center",
            fontSize: 32,
            lineHeight: 1.3,
            opacity: interpolate(frame, [8, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          “RFC 8312 has a two-way handshake. Why don’t we cover that?”
        </p>
      </div>
    </CartoonStage>
  );
}

export function SceneCutTabs() {
  const frame = useCurrentFrame();
  const tabs = [
    "lecture-04.pdf",
    "textbook",
    "RFC 793",
    "Wikipedia",
    "syllabus",
    "Gmail",
    "Canvas",
    "notes",
    "Drive",
    "Chat",
  ];
  const on = Math.floor(frame / 8) % tabs.length;
  return (
    <CartoonStage>
      <Stamp />
      <div style={{ width: "100%", maxWidth: 1600 }}>
        <div
          style={{
            border: `6px solid ${INK}`,
            boxShadow: `10px 10px 0 ${INK}`,
            background: "#fff8e8",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", borderBottom: `5px solid ${INK}`, overflow: "hidden" }}>
            {tabs.map((tab, i) => (
              <div
                key={tab}
                style={{
                  flex: "0 0 auto",
                  padding: "14px 16px",
                  fontSize: 16,
                  background: i === on ? ORANGE : "transparent",
                  borderRight: `3px solid ${INK}`,
                }}
              >
                {tab}
              </div>
            ))}
          </div>
          <p style={{ margin: 36, fontSize: 36 }}>Forty students. Fourteen tabs.</p>
        </div>
      </div>
    </CartoonStage>
  );
}

export function SceneCutRant() {
  const frame = useCurrentFrame();
  const second = frame >= 160;
  return (
    <CartoonStage>
      <Stamp text={second ? "CITE OR SILENCE" : "WHAT I CAN'T STAND"} />
      <div style={{ display: "flex", alignItems: "center", gap: 48, maxWidth: 1500 }}>
        <Cast file={second ? "chen-smile.png" : "chen-panic.png"} size={400} />
        <div>
          <p style={{ margin: 0, fontSize: 42, lineHeight: 1.2 }}>
            {second ? "If it's not in the file, the card stays empty." : "You know what I can't stand?"}
          </p>
          <p style={{ margin: "18px 0 0", fontSize: 32, color: TEAL }}>{second ? "No guessing. No BS." : "Guessing."}</p>
        </div>
      </div>
    </CartoonStage>
  );
}

export function SceneCutMike() {
  return (
    <CartoonStage>
      <div style={{ display: "flex", alignItems: "center", gap: 40, maxWidth: 1400 }}>
        <Cast file="mike.png" size={340} />
        <p style={{ margin: 0, fontSize: 40, lineHeight: 1.25 }}>“Dr. Chen, will this be on the final?”</p>
      </div>
    </CartoonStage>
  );
}

export function SceneCutEnd() {
  const frame = useCurrentFrame();
  const form = interpolate(frame, [8, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const line = interpolate(frame, [70, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <CartoonStage>
      <div style={{ textAlign: "center", maxWidth: 980 }}>
        <p style={{ margin: 0, fontFamily: "Impact, Haettenschweiler, sans-serif", fontSize: 28, letterSpacing: "0.22em" }}>
          MEETHINT
        </p>
        <p style={{ margin: "16px 0 0", fontSize: 36 }}>Join the waitlist — free during beta.</p>
        <div style={{ margin: "28px auto 0", maxWidth: 620, display: "flex", gap: 10, opacity: form }}>
          <div
            style={{
              flex: 1,
              border: `5px solid ${INK}`,
              boxShadow: `6px 6px 0 ${INK}`,
              background: "#fff8e8",
              padding: "14px 16px",
              textAlign: "left",
              fontSize: 20,
              color: TEAL,
            }}
          >
            you@work.com
          </div>
          <div
            style={{
              border: `5px solid ${INK}`,
              boxShadow: `6px 6px 0 ${INK}`,
              background: ORANGE,
              padding: "14px 18px",
              fontSize: 18,
            }}
          >
            Get early access
          </div>
        </div>
        <p style={{ margin: "32px 0 0", fontSize: 40, opacity: line }}>Cite or silence.</p>
      </div>
    </CartoonStage>
  );
}
