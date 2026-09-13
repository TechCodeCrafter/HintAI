#!/usr/bin/env node
/**
 * Sync GitHub repository chrome (homepage, topics, description) after deploy.
 * Requires `gh auth login`. Safe to re-run — idempotent edits only.
 */
import { spawnSync } from "node:child_process";

const REPO = "TechCodeCrafter/HintAI";
const HOMEPAGE = "https://meethint.ai";
const DESCRIPTION = "Cite or silence — live meeting copilot that cites your files or stays silent.";
const TOPICS = [
  "meeting-copilot",
  "rag",
  "citations",
  "typescript",
  "react",
  "vite",
  "live-search",
];

function gh(args) {
  const run = spawnSync("gh", args, { encoding: "utf8", stdio: "pipe" });
  if (run.status !== 0) {
    const msg = (run.stderr || run.stdout || "").trim();
    throw new Error(msg || `gh ${args.join(" ")} failed`);
  }
  return (run.stdout || "").trim();
}

function main() {
  try {
    gh(["repo", "view", REPO, "--json", "nameWithOwner"]);
  } catch {
    console.error("GitHub CLI is not authenticated. Run: gh auth login");
    process.exit(1);
  }

  const editArgs = ["repo", "edit", REPO, "--homepage", HOMEPAGE, "--description", DESCRIPTION];
  for (const topic of TOPICS) editArgs.push("--add-topic", topic);
  gh(editArgs);
  console.log(`Updated ${REPO}: homepage=${HOMEPAGE}, topics=${TOPICS.join(", ")}`);
}

main();
