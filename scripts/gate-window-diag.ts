/**
 * store.heard() feeds the gate the last 8 "them" utterances joined into one
 * string. This asks what that does as a call goes on: does the newest question
 * still win once earlier ones are sitting in the same window?
 */
import { readFileSync } from "node:fs";
import { liveQuestionFromTranscript } from "../src/lib/search/question";
import { buildChunks, packVocabulary } from "../src/lib/search/retrieve";
import type { RepoPack } from "../src/lib/types";

const pack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8")) as RepoPack;
const gate = { vocab: packVocabulary(buildChunks(pack)), threadOpen: false };

const ASKED = [
  "What does the BDA ingest worker do?",
  "How does the Excel export work?",
  "Where does document upload happen?",
  "Why is the extraction done in a container lambda?",
  "How is the data indexed for RAG?",
];
const CHATTER = ["Can you hear me?", "Can everyone see my screen?", "Should we move on?"];

console.log("Newest question is always the LAST item in the window.\n");
console.log("  window  extracted query                                             newest?");

const history: string[] = [];
for (let i = 0; i < 12; i += 1) {
  // A real call alternates chatter and questions; both land in `them`.
  const next = i % 3 === 2 ? CHATTER[Math.floor(i / 3) % CHATTER.length] : ASKED[i % ASKED.length];
  history.push(next);
  const window = history.slice(-8).join(" ");
  const got = liveQuestionFromTranscript(window, gate);
  const expected = i % 3 === 2 ? null : next;
  const ok = expected === null ? (got ? "FALSE TRIGGER" : "silent (ok)") : got === expected ? "yes" : "STALE/WRONG";
  console.log(`  ${String(history.slice(-8).length).padStart(6)}  ${String(got ?? "(none)").padEnd(60).slice(0, 60)}  ${ok}`);
  if (expected && got !== expected) console.log(`          wanted: ${expected}`);
}
