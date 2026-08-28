export type ScriptBeat = {
  delayMs: number;
  speaker: string;
  role: "them" | "you" | "system";
  text: string;
};

export const DESIGN_REVIEW: ScriptBeat[] = [
  {
    delayMs: 250,
    speaker: "Maya",
    role: "them",
    text: "Alright — exporter first. What actually shipped?",
  },
  {
    delayMs: 1100,
    speaker: "You",
    role: "you",
    text: "Settlement CSV is in production. Retry path is the bit people keep asking about.",
  },
  {
    delayMs: 2200,
    speaker: "Alex",
    role: "them",
    text: "What did we change in the exporter?",
  },
  {
    delayMs: 3600,
    speaker: "Maya",
    role: "them",
    text: "And why does that retry three times? Finance thought it was a generic backoff.",
  },
  {
    delayMs: 5400,
    speaker: "Jordan",
    role: "them",
    text: "While we are here — who touched the auth flow? Session cookies keep coming up in the incident channel.",
  },
  {
    delayMs: 7200,
    speaker: "Maya",
    role: "them",
    text: "If we raise retries to five, does that even help the gateway timeouts?",
  },
];
