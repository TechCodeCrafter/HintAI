import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { MeetHintMark } from "@/components/meethint-mark";
import { eyebrow, FPS, T } from "./theme";
import voManifest from "./vo-manifest.json";

/**
 * The ad, in seven beats: a question you can't answer, the minute you'd lose
 * looking for it, the turn, the answer with its citation, the range, the
 * refusal, the close.
 *
 * Two rules hold it together. Every beat gets its own visual language — the
 * product card appears exactly once, as the payoff, because three of them in a
 * row is a feature tour, not an ad. And the cuts sit on the score's marks
 * (scripts/make-score.mjs): the impact at 11s opens the turn, the arrangement
 * strips back at 32s under the refusal, the last swell lands on the logo. Move
 * a duration here and the music no longer means anything.
 */

/**
 * Narration comes from one of two places, and neither is required — the film is
 * built to read with the sound off, which is how most of a feed watches video.
 *
 *  - A single recording of your own voice: `--props '{"narration":"vo.mp3"}'`.
 *  - Per-line clips from `npm run voice`, placed on their own beats so the read
 *    cannot drift out of sync with the cuts.
 *
 * Either way the score ducks underneath. A recording passed in wins, because a
 * real voice should never lose to a generated one.
 */
export type DemoProps = { narration: string | null };

/** The manifest ships with an empty list, which TypeScript reads as never[]. */
type VoClip = { file: string; at: number; seconds: number };
const VO_CLIPS = voManifest.clips as VoClip[];

/**
 * Timed to the scenes below. Conversational, ~105 wpm, and deliberately short
 * of the frame length in every beat — the silences are where the type lands.
 *
 * It follows a sales arc rather than a feature list: the problem, what the
 * product is, what you get, where it applies, the objection, the ask.
 *
 *  0:00  "Someone asks about a service you shipped last spring."
 *  0:04  "You know it exists. You don't remember the number."
 *  0:07  "And the room is waiting."
 *  0:11  "This is MeetHint. It listens to the meeting, and searches the files
 *         you brought."
 *  0:15  "So when the question comes, you get the fact — and the file and line
 *         it came from."
 *  0:23  "A repo, a contract, a deck. Any room, same engine."
 *  0:32  "And when your material doesn't cover it, MeetHint says nothing."
 *  0:36  "No guessing. That's the whole point."
 *  0:39  "MeetHint. Join the private beta, at meethint dot A I."
 */

const SCENES = [
  { kind: "open" as const, duration: 135 },
  { kind: "gap" as const, duration: 195 },
  { kind: "turn" as const, duration: 120 },
  { kind: "payoff" as const, duration: 240 },
  { kind: "breadth" as const, duration: 270 },
  { kind: "refusal" as const, duration: 180 },
  { kind: "close" as const, duration: 150 },
];

export const DEMO_DURATION = SCENES.reduce((total, scene) => total + scene.duration, 0);

const ASKED = "What did we end up doing about checkout recovery?";

/** Scene-level cross-fade so cuts don't strobe on a dark background. */
function Fade({ duration, children }: { duration: number; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, duration - 8, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Stage({ children, vignette = true }: { children: React.ReactNode; vignette?: boolean }) {
  return (
    <AbsoluteFill
      style={
        {
          // No background colour here on purpose: this sits inside the layer that
          // animates opacity, and compositing a flat near-black twice rounds to a
          // 1/255 lift you can see as a faint rectangle during crossfades. The
          // root fill owns the background instead.
          backgroundImage: vignette
            ? `radial-gradient(1100px 620px at 74% -10%, rgba(139,123,245,0.06), transparent 62%),
               radial-gradient(900px 520px at -4% 106%, rgba(47,107,247,0.03), transparent 60%)`
            : "none",
          fontFamily: T.mono,
          color: T.fg,
          alignItems: "center",
          justifyContent: "center",
          padding: 120,
          "--color-brand-blue": T.brandBlue,
          "--color-brand-violet": T.brandViolet,
          "--color-brand-signal": T.signal,
        } as CSSProperties
      }
    >
      {children}
    </AbsoluteFill>
  );
}

function Wordmark({ size = 44 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.32 }}>
      <MeetHintMark style={{ width: size, height: size }} />
      <span style={{ fontSize: size * 0.5, letterSpacing: "0.28em", fontWeight: 500 }}>
        MEETHINT
      </span>
    </div>
  );
}

const ease = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// ---------------------------------------------------------------------------
// 1. Cold open — the question, and nothing else on screen.
// ---------------------------------------------------------------------------

function SceneOpen() {
  const frame = useCurrentFrame();
  const typed = Math.max(0, Math.min(ASKED.length, Math.round((frame - 20) * 1.5)));
  const typing = frame >= 20 && typed < ASKED.length;

  return (
    <Stage vignette={false}>
      <div style={{ width: 1500 }}>
        <p style={{ ...eyebrow, margin: 0, fontSize: 22, opacity: ease(frame, 0, 14) }}>
          Platform review · fourteen minutes in
        </p>
        <p
          style={{
            margin: "44px 0 0",
            fontFamily: T.serif,
            fontSize: 84,
            lineHeight: 1.24,
            color: T.fg,
          }}
        >
          {ASKED.slice(0, typed)}
          {typing ? (
            <span
              style={{
                display: "inline-block",
                width: 26,
                height: 70,
                marginLeft: 8,
                verticalAlign: -10,
                background: T.accent,
                opacity: frame % 16 < 8 ? 1 : 0.2,
              }}
            />
          ) : null}
        </p>
        <p
          style={{
            margin: "56px 0 0",
            fontSize: 32,
            color: T.muted,
            opacity: ease(frame, 100, 118),
          }}
        >
          You shipped it. You don't remember it.
        </p>
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// 2. The gap — where the answer actually is, and the clock running while you look.
// ---------------------------------------------------------------------------

const DEAD_ENDS = [
  "Confluence · forty pages, none of them current",
  "Slack · three months of scroll",
  "the pull request, if you could name it",
  "the ADR nobody linked",
  "the person who wrote it, on holiday",
];

function SceneGap() {
  const frame = useCurrentFrame();
  // Stops short of the "nine seconds" line below: a minute on the clock would
  // read as a joke rather than a room going quiet.
  const elapsed = interpolate(frame, [0, 175], [2, 16], { extrapolateRight: "clamp" });
  const seconds = Math.floor(elapsed);

  return (
    <Stage vignette={false}>
      <div style={{ width: 1560 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <p
            style={{
              margin: 0,
              maxWidth: 860,
              fontFamily: T.serif,
              fontSize: 40,
              lineHeight: 1.35,
              color: T.muted,
            }}
          >
            “{ASKED}”
          </p>
          <div style={{ textAlign: "right" }}>
            <p style={{ ...eyebrow, margin: 0, fontSize: 19 }}>Since they asked</p>
            <p
              style={{
                margin: "12px 0 0",
                fontSize: 92,
                fontVariantNumeric: "tabular-nums",
                color: seconds > 25 ? T.fg : T.muted,
              }}
            >
              0:{String(seconds).padStart(2, "0")}
            </p>
          </div>
        </div>

        <div
          style={{
            height: 1,
            margin: "54px 0 48px",
            background: `linear-gradient(90deg, ${T.line}, transparent)`,
          }}
        />

        <p style={{ ...eyebrow, margin: 0, fontSize: 21 }}>Where the answer is</p>
        <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 22 }}>
          {DEAD_ENDS.map((item, i) => {
            const start = 14 + i * 22;
            const inn = ease(frame, start, start + 12);
            // Each dead end is struck through as the next one arrives: the search
            // isn't just slow, it keeps failing.
            const struck = ease(frame, start + 26, start + 40);
            return (
              <div
                key={item}
                style={{
                  position: "relative",
                  fontSize: 36,
                  color: T.body,
                  opacity: inn * (1 - struck * 0.55),
                  transform: `translateX(${interpolate(inn, [0, 1], [-18, 0])}px)`,
                  alignSelf: "flex-start",
                }}
              >
                {item}
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "52%",
                    height: 2,
                    width: `${struck * 100}%`,
                    background: T.faint,
                  }}
                />
              </div>
            );
          })}
        </div>

        <p
          style={{
            margin: "58px 0 0",
            fontFamily: T.serif,
            fontSize: 46,
            color: T.fg,
            opacity: ease(frame, 152, 170),
          }}
        >
          You have about nine seconds before you start guessing.
        </p>
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// 3. The turn — lands on the score's impact.
// ---------------------------------------------------------------------------

const MATERIAL = [
  "checkout/",
  "ADR-014.pdf",
  "incident-notes.md",
  "MSA-northwind.pdf",
  "CODEOWNERS",
  "postmortems/",
];

function SceneTurn() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hit = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const chunks = Math.round(interpolate(frame, [38, 74], [0, 1204], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));

  return (
    <Stage>
      {/* Flash on the downbeat, gone in a third of a second. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(760px 760px at 50% 46%, rgba(139,123,245,${0.2 * (1 - ease(frame, 0, 11))}), transparent 70%)`,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 52 }}>
        <div style={{ transform: `scale(${interpolate(hit, [0, 1], [0.86, 1])})`, opacity: hit }}>
          <Wordmark size={62} />
        </div>

        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: 1400,
          }}
        >
          {MATERIAL.map((file, i) => {
            const enter = spring({
              frame: frame - (14 + i * 5),
              fps,
              config: { damping: 200 },
            });
            return (
              <span
                key={file}
                style={{
                  padding: "16px 28px",
                  borderRadius: 999,
                  border: `1px solid ${T.line}`,
                  background: "rgba(255,255,255,0.03)",
                  fontSize: 30,
                  color: T.body,
                  opacity: enter,
                  transform: `translateY(${interpolate(enter, [0, 1], [22, 0])}px)`,
                }}
              >
                {file}
              </span>
            );
          })}
        </div>

        <div style={{ textAlign: "center", opacity: ease(frame, 36, 48) }}>
          <p style={{ margin: 0, fontSize: 34, color: T.accent }}>
            38 files · {chunks.toLocaleString()} chunks · indexed on your machine
          </p>
          {/* The one line that says what the product actually is. Nothing else in
            the film does this job, and an ad that never says it isn't an ad. */}
          <p
            style={{
              margin: "26px auto 0",
              maxWidth: 1360,
              fontFamily: T.serif,
              fontSize: 58,
              lineHeight: 1.24,
              color: T.fg,
              opacity: ease(frame, 70, 88),
            }}
          >
            Bring the material once. MeetHint listens, and searches it live.
          </p>
        </div>
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// 4. The payoff — the product card, used exactly once in the film.
// ---------------------------------------------------------------------------

const CITATIONS = [
  { at: "incident-notes.md:12", fact: "checkout recovery, P50 40m → 9m" },
  { at: "PR #2841", fact: "retry budget moved per-shard" },
  { at: "ADR-014 · p. 2", fact: "queue taken off the request path" },
];

function ScenePayoff({ duration }: { duration: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const searchStart = 26;
  const searchEnd = 62;
  const searching = frame >= searchStart && frame < searchEnd;
  const resolved = frame >= searchEnd;

  return (
    <Stage>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
        <div
          style={{
            width: 1620,
            borderRadius: 22,
            border: `1px solid ${T.line}`,
            background: "linear-gradient(180deg, rgba(255,255,255,0.032), rgba(255,255,255,0.008))",
            boxShadow: "0 40px 90px -50px rgba(0,0,0,0.95)",
            overflow: "hidden",
            transform: `translateY(${interpolate(ease(frame, 0, 14), [0, 1], [22, 0])}px)`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "26px 42px",
              borderBottom: `1px solid ${T.hairline}`,
              fontSize: 25,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 99,
                  background: T.accent,
                  boxShadow: `0 0 14px ${T.accent}`,
                  opacity: 0.55 + 0.45 * Math.sin((frame / fps) * 4),
                }}
              />
              <span style={{ ...eyebrow, fontSize: 20, color: T.accent }}>Listening</span>
              <span style={{ color: T.faint }}>· Platform review</span>
            </div>
            <span style={{ color: T.faint }}>38 files · repo + 4 docs</span>
          </div>

          <div style={{ padding: "50px 56px 56px" }}>
            <p style={{ ...eyebrow, margin: 0 }}>They asked</p>
            <p
              style={{
                margin: "16px 0 0",
                fontFamily: T.serif,
                fontSize: 58,
                lineHeight: 1.3,
                color: T.body,
              }}
            >
              {ASKED}
            </p>

            <div
              style={{
                height: 1,
                margin: "38px 0 34px",
                background: `linear-gradient(90deg, transparent, ${T.line}, transparent)`,
              }}
            />

            <div style={{ minHeight: 306 }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
              >
                <p style={{ ...eyebrow, margin: 0 }}>From your material</p>
                <span style={{ fontSize: 21, color: T.faint, opacity: resolved ? 1 : 0 }}>
                  you last touched checkout/ in March
                </span>
              </div>

              {searching ? (
                <p style={{ margin: "24px 0 0", fontSize: 32, color: T.accent }}>
                  Searching 1,204 chunks across 38 files…
                </p>
              ) : null}

              {resolved
                ? CITATIONS.map((source, i) => {
                    const enter = spring({
                      frame: frame - (searchEnd + i * 10),
                      fps,
                      config: { damping: 200 },
                    });
                    return (
                      <div
                        key={source.at}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 26,
                          padding: "22px 0",
                          borderBottom:
                            i < CITATIONS.length - 1 ? `1px solid ${T.hairline}` : "none",
                          fontSize: 32,
                          opacity: enter,
                          transform: `translateY(${interpolate(enter, [0, 1], [12, 0])}px)`,
                        }}
                      >
                        <span style={{ color: T.accent, whiteSpace: "nowrap" }}>{source.at}</span>
                        <span style={{ color: T.body }}>{source.fact}</span>
                      </div>
                    );
                  })
                : null}
            </div>
          </div>

          <div style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
            <div
              style={{
                height: "100%",
                width: `${interpolate(frame, [0, duration], [0, 100], { extrapolateRight: "clamp" })}%`,
                background: T.accent,
              }}
            />
          </div>
        </div>

        <p
          style={{
            margin: 0,
            fontFamily: T.serif,
            fontSize: 44,
            color: T.fg,
            opacity: ease(frame, 108, 126),
          }}
        >
          The file. The line. While they're still talking.
        </p>
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// 5. Breadth — a ticker, not a card. Six rooms in nine seconds.
// ---------------------------------------------------------------------------

const RANGE = [
  { q: "Is retention thirty days or ninety for them?", at: "MSA.pdf · p. 9", fact: "ninety, deletion on written request" },
  { q: "Who owns the billing webhook now?", at: "CODEOWNERS:14", fact: "platform-payments, since the April split" },
  { q: "What did the postmortem blame?", at: "incident-2024-11.md:41", fact: "backoff was linear, not exponential" },
  { q: "Did the Postgres migration ever ship?", at: "PR #3110", fact: "merged behind a flag, still off in eu-west" },
  { q: "What's in scope for phase two?", at: "statement-of-work.pdf · p. 6", fact: "read-only reporting, nothing written back" },
  { q: "How do services authenticate to each other?", at: "auth/server.ts:42", fact: "mTLS, certificates rotated by the mesh" },
];

const SLOT = 42;

function SceneBreadth() {
  const frame = useCurrentFrame();
  const progress = Math.max(0, (frame - 14) / SLOT);

  return (
    <Stage>
      <div style={{ width: 1560, position: "relative", height: 760 }}>
        <p style={{ ...eyebrow, margin: 0, fontSize: 22, opacity: ease(frame, 0, 14) }}>
          Same engine · any room
        </p>

        {RANGE.map((item, i) => {
          // Each row rises through the centre line: one continuous gesture rather
          // than six repeats of the same card.
          const slot = i - progress;
          if (slot < -1.5 || slot > 1.5) return null;
          const focus = Math.max(0, 1 - Math.abs(slot));
          return (
            <div
              key={item.at}
              style={{
                position: "absolute",
                top: 320 + slot * 250,
                left: 0,
                right: 0,
                // Rows either side stay faintly legible, so the frame always has
                // depth and the next question is arriving before it's needed.
                opacity: Math.max(0, 1 - Math.abs(slot) / 1.45) ** 1.4,
                transform: `scale(${0.92 + focus * 0.08})`,
                transformOrigin: "left center",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontFamily: T.serif,
                  fontSize: 62,
                  lineHeight: 1.2,
                  color: T.fg,
                }}
              >
                {item.q}
              </p>
              <div
                style={{
                  marginTop: 26,
                  display: "flex",
                  alignItems: "baseline",
                  gap: 24,
                  fontSize: 32,
                }}
              >
                <span style={{ color: T.accent, whiteSpace: "nowrap" }}>{item.at}</span>
                <span style={{ color: T.muted }}>{item.fact}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// 6. The refusal — the score falls away here on purpose.
// ---------------------------------------------------------------------------

function SceneRefusal() {
  const frame = useCurrentFrame();

  return (
    <Stage vignette={false}>
      <div style={{ width: 1480, textAlign: "center" }}>
        <p
          style={{
            margin: 0,
            fontFamily: T.serif,
            fontSize: 62,
            lineHeight: 1.26,
            color: T.muted,
            opacity: ease(frame, 0, 16),
          }}
        >
          “So where are we on the SOC 2 audit?”
        </p>

        <p
          style={{
            margin: "46px 0 0",
            fontSize: 30,
            color: T.accent,
            // Searching, then the search is simply over.
            opacity: ease(frame, 22, 32) * (1 - ease(frame, 58, 68)),
          }}
        >
          Searching 1,204 chunks across 38 files…
        </p>

        <p
          style={{
            margin: "36px 0 0",
            fontFamily: T.serif,
            fontSize: 76,
            lineHeight: 1.2,
            color: T.fg,
            opacity: ease(frame, 72, 90),
            transform: `translateY(${interpolate(ease(frame, 72, 90), [0, 1], [14, 0])}px)`,
          }}
        >
          Nothing you brought answers that.
        </p>
        <p
          style={{
            margin: "38px auto 0",
            maxWidth: 1320,
            fontSize: 34,
            lineHeight: 1.6,
            color: T.muted,
            opacity: ease(frame, 104, 122),
          }}
        >
          So MeetHint says nothing. No paraphrase, no guess, nothing you would walk back later.
        </p>
      </div>
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// 7. Close — on the final swell.
// ---------------------------------------------------------------------------

function SceneClose() {
  const frame = useCurrentFrame();
  const rise = ease(frame, 0, 18);

  return (
    <Stage>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 40,
          opacity: rise,
          transform: `translateY(${interpolate(rise, [0, 1], [18, 0])}px)`,
        }}
      >
        <Wordmark size={64} />
        <div style={{ textAlign: "center", fontFamily: T.serif }}>
          <p style={{ margin: 0, fontSize: 54, color: T.body }}>
            Your files stay the source of truth.
          </p>
          <p style={{ margin: "16px 0 0", fontSize: 88, lineHeight: 1.14, color: T.fg }}>
            The meeting just became searchable.
          </p>
        </div>
        {/* An end card has to ask for something. */}
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "18px 34px",
            borderRadius: 999,
            border: `1px solid ${T.line}`,
            background: "rgba(139,123,245,0.06)",
            opacity: ease(frame, 28, 44),
          }}
        >
          <span style={{ fontSize: 34, color: T.accent }}>Join the private beta</span>
          <span style={{ fontSize: 34, color: T.faint }}>meethint.ai</span>
        </div>
      </div>
    </Stage>
  );
}

export function Demo({ narration }: DemoProps) {
  const spoken = Boolean(narration) || VO_CLIPS.length > 0;
  let at = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: T.bg }}>
      {SCENES.map((scene, i) => {
        const from = at;
        at += scene.duration;
        return (
          <Sequence key={i} from={from} durationInFrames={scene.duration}>
            <Fade duration={scene.duration}>
              {scene.kind === "open" ? <SceneOpen /> : null}
              {scene.kind === "gap" ? <SceneGap /> : null}
              {scene.kind === "turn" ? <SceneTurn /> : null}
              {scene.kind === "payoff" ? <ScenePayoff duration={scene.duration} /> : null}
              {scene.kind === "breadth" ? <SceneBreadth /> : null}
              {scene.kind === "refusal" ? <SceneRefusal /> : null}
              {scene.kind === "close" ? <SceneClose /> : null}
            </Fade>
          </Sequence>
        );
      })}

      <Audio
        src={staticFile("score.wav")}
        // Ducked under a voice track if there is one; the wav's own arrangement
        // handles the rest of the dynamics.
        volume={(f) => ease(f, 0, 18) * (spoken ? 0.3 : 1)}
      />
      {narration ? <Audio src={staticFile(narration)} /> : null}
      {!narration
        ? VO_CLIPS.map((clip) => (
            <Sequence key={clip.file} from={Math.round(clip.at * FPS)}>
              <Audio src={staticFile(clip.file)} />
            </Sequence>
          ))
        : null}
    </AbsoluteFill>
  );
}
