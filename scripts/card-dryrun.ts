/**
 * Non-architecture dry runs for claim-first localCard.
 *
 * Prints the query, the spoken claim, the citation, and the exact evidence text
 * the claim was read from — so every line can be checked against the file.
 *
 * node --experimental-strip-types scripts/card-dryrun.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import type { RepoPack } from "../src/lib/repo/types.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { citationText, citedSource } from "../src/lib/search/cite.ts";
import { buildChunks, retrieve } from "../src/lib/search/retrieve.ts";

// This script quotes every test query, so it would rank as its own answer.
const SKIP = /node_modules|\.git\b|dist|\.output|screenshots|\.vite|package-lock|card-dryrun/;

function selfPack(): RepoPack {
  const files: RepoPack["files"] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = `${dir}/${entry}`;
      if (SKIP.test(p)) continue;
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs|md)$/.test(p) && s.size < 200_000) {
        files.push({
          path: p.replace(/^\.\//, ""),
          language: "ts",
          content: readFileSync(p, "utf8").slice(0, 80_000),
        });
      }
    }
  };
  walk(".");
  return {
    id: "group-copilot",
    name: "group-copilot",
    description: "GROUND's own source",
    files: files.slice(0, 220),
    commits: [],
  };
}

// Shaped like the loaded backend. Docstrings written in the plain style real
// FastAPI route modules use — this pack is synthetic, the self pack below is not.
const FASTAPI: RepoPack = {
  id: "rdb-labsai-backend",
  name: "rdb-labsai-backend",
  description: "synthetic pack shaped like the loaded backend",
  files: [
    {
      path: "api/main.py",
      language: "py",
      content: [
        '"""',
        "FastAPI Main Application",
        "",
        "REST API for Synthes Biocompatibility Data Extraction System.",
        "",
        "This API provides endpoints for:",
        "- Session management",
        "- Document upload and processing",
        "- Data extraction",
        "- Excel export generation",
        '"""',
        "from fastapi import FastAPI",
        "app = FastAPI()",
      ].join("\n"),
    },
    {
      path: "api/routes/upload.py",
      language: "py",
      content: [
        '"""',
        "Document upload routes.",
        "",
        "Accepts a PDF or DOCX file, stores it in S3 under the session prefix, and",
        "queues a Bedrock Data Automation job for the document.",
        '"""',
        "",
        "async def upload_document(session_id: str, file: UploadFile):",
        "    key = store_in_s3(session_id, file)",
        "    return queue_bda_job(session_id, key)",
      ].join("\n"),
    },
    {
      path: "api/routes/export.py",
      language: "py",
      content: [
        '"""',
        "Excel export routes.",
        "",
        "Builds the biocompatibility workbook from extracted rows using openpyxl and",
        "returns a presigned download URL.",
        '"""',
        "",
        "def build_workbook(rows):",
        "    wb = Workbook()",
        "    return wb",
      ].join("\n"),
    },
    {
      path: "container-lambdas/synthes-iceberg-processor/app/aggregator.py",
      language: "py",
      content: [
        '"""',
        "Iceberg aggregation worker.",
        "",
        "Extraction runs in a container lambda because the openpyxl and pandas layer",
        "exceeds the 250 MB zip limit for a standard lambda deployment.",
        '"""',
        "",
        "def aggregate(rows):",
        "    return rows",
      ].join("\n"),
    },
    {
      path: "container-lambdas/bda-ingest-worker/app/lambda_function.py",
      language: "py",
      content: '"""BDA ingest worker."""\n\ndef handler(event, ctx):\n    return run(event)',
    },
  ],
  commits: [],
};

const SUITES: Array<{ label: string; pack: RepoPack; queries: string[] }> = [
  {
    label: "SYNTHETIC — FastAPI-shaped pack (your four questions, verbatim)",
    pack: FASTAPI,
    queries: [
      "How does document upload work?",
      "How is the Excel export generated?",
      "What happens after a document is uploaded?",
      "Why is this handled in the worker?",
    ],
  },
  {
    label: "REAL — GROUND's own source",
    pack: selfPack(),
    queries: [
      "How does caption cleaning work?",
      "How does retrieval score the chunks?",
      "Why is this handled in the worker?",
      "What happens after an utterance is committed?",
      "How does the question gate work?",
    ],
  },
];

for (const suite of SUITES) {
  console.log(`\n${"=".repeat(74)}`);
  console.log(suite.label);
  console.log(`${suite.pack.name} — ${suite.pack.files.length} files`);
  console.log("=".repeat(74));

  const chunks = buildChunks(suite.pack);
  for (const query of suite.queries) {
    const hits = retrieve(query, chunks, 6);
    const card = localCard(query, hits, suite.pack, 0);
    console.log(`\nQ  ${query}`);
    console.log(
      `   HITS  ${hits.map((h) => `${h.path}:${h.startLine}(${h.score.toFixed(1)})`).join(" ") || "none"}`,
    );
    if (!card.say) {
      console.log(`   SILENT — ${card.reason ?? "no reason given"}`);
      if (card.citations[0]) console.log(`   would cite: ${citationText(card.citations[0])}`);
      continue;
    }
    console.log(`   SAY   ${card.say}`);
    for (const cite of card.citations) {
      console.log(`   CITE  ${citationText(cite)}${cite.label ? `  [${cite.label}]` : ""}`);
    }
    // Prove the claim is in what it cited, whichever kind that is.
    const cited = card.citations.map((c) => citedSource(c, suite.pack)).join("\n").toLowerCase();
    const words = card.say.replace(/[.,:;—]/g, " ").split(/\s+/).filter((w) => w.length > 4);
    const missing = words.filter((w) => !cited.includes(w.toLowerCase()));
    console.log(
      `   CHECK ${missing.length === 0 ? "every content word appears in the cited material" : `NOT IN EVIDENCE: ${missing.join(", ")}`}`,
    );
    const sentences = card.say.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    console.log(`   SHAPE ${card.say.length} chars, ${sentences} sentence(s)`);
  }
}
