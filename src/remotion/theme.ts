import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadSerif } from "@remotion/google-fonts/Newsreader";

// Only the weights and subset the demo actually uses: the default pulls every
// variant, which is ~100 font requests on every one of the 720 rendered frames.
const { fontFamily: mono } = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });
const { fontFamily: serif } = loadSerif("normal", { weights: ["400", "500"], subsets: ["latin"] });

/**
 * Mirrors the tokens in src/styles.css. The video is a recording of the product,
 * so anything that drifts from these values shows up as an obviously fake demo.
 * Remotion renders outside Tailwind, hence the duplication.
 */
export const T = {
  bg: "#07090c",
  panel: "rgba(255, 255, 255, 0.028)",
  panelSolid: "#0d1116",
  line: "rgba(255, 255, 255, 0.09)",
  hairline: "rgba(255, 255, 255, 0.06)",
  fg: "#e8edf2",
  body: "#aeb9c4",
  secondary: "#8b98a5",
  muted: "#7d8a97",
  faint: "#5d6a77",
  faintest: "#45505c",
  accent: "#8b7bf5",
  /** For rgba() washes and glows, which need the channels separately. */
  accentRgb: "139, 123, 245",
  brandBlue: "#2f6bf7",
  brandViolet: "#8a4ff0",
  signal: "#dfe4ff",
  mono,
  serif,
} as const;

export const FPS = 30;

/** Uppercase tracked label, same role as .mh-eyebrow on the page. */
export const eyebrow = {
  fontFamily: T.mono,
  fontSize: 18,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: T.faint,
};
