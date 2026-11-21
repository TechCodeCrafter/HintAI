#!/usr/bin/env node
/**
 * Time the public demo's in-process answer on the built-in payments pack.
 *
 * This is the retrieve-and-cite step only. It does not open a browser, so it
 * is not a cold page-load measurement. The number belongs in PERFORMANCE-TARGET
 * as the answer-step baseline.
 *
 *   node scripts/demo-timing.mjs
 *   node scripts/demo-timing.mjs --check
 */
import { performance } from "node:perf_hooks";

const QUESTION = "Why does that retry three times?";
const RUNS = 5;
const LIMIT_MS = 2000;
const check = process.argv.includes("--check");

const { demoAnswer } = await import(new URL("../src/lib/demo/answer.ts", import.meta.url).href);

const samples = [];
let cited = false;
for (let i = 0; i < RUNS; i += 1) {
  const started = performance.now();
  const card = demoAnswer(QUESTION, started);
  const ms = performance.now() - started;
  samples.push(ms);
  if (card.say && card.citations.length > 0) cited = true;
}
samples.sort((a, b) => a - b);
const p95 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)];
const line = `demo answer step "${QUESTION}": cited=${cited} p95=${p95.toFixed(1)}ms over ${RUNS} runs`;
console.log(line);
if (!cited) {
  console.error("demo answer was not cited");
  process.exit(1);
}
if (check && p95 > LIMIT_MS) {
  console.error(`p95 ${p95.toFixed(1)}ms exceeds ${LIMIT_MS}ms`);
  process.exit(1);
}
