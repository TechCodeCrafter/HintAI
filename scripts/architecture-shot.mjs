/**
 * Seeds a pack shaped like the loaded rdb-labsai-backend, asks the end-to-end
 * question through the real Search path, and screenshots the rendered Card.
 *
 * node scripts/architecture-shot.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const SHOTS = "screenshots/";
mkdirSync(SHOTS, { recursive: true });

const MAIN = [
  '"""',
  "FastAPI Main Application",
  "Building...",
  "",
  "REST API for Synthes Biocompatibility Data Extraction System.",
  "",
  "This API provides endpoints for:",
  "- Session management",
  "- Document upload and processing",
  "- Data extraction",
  "- Excel export generation",
  "",
  "Server runs on http://0.0.0.0:8000 for external access.",
  '"""',
  "from fastapi import FastAPI",
  "app = FastAPI()",
].join("\n");

const LAMBDAS = [
  "bda-ingest-worker",
  "global-rag-compactor",
  "global-rag-indexer",
  "synthes-chat-agent",
  "synthes-iceberg-processor",
  "synthes-doc-splitter",
  "synthes-excel-writer",
];

const pack = {
  id: "rdb-labsai-backend",
  name: "rdb-labsai-backend",
  description: "loaded folder",
  files: [
    { path: "api/main.py", language: "py", content: MAIN },
    { path: "api/client.py", language: "py", content: "class Client:\n    pass" },
    { path: "api/config.py", language: "py", content: "SETTINGS = {}" },
    { path: "api/dependencies.py", language: "py", content: "def get_db():\n    pass" },
    { path: "api/middleware.py", language: "py", content: "def add_cors(app):\n    pass" },
    ...LAMBDAS.map((name) => ({
      path: `container-lambdas/${name}/app/lambda_function.py`,
      language: "py",
      content: "def handler(event, ctx):\n    return run(event)",
    })),
    { path: "core/settings.py", language: "py", content: "REGION = 'us-east-1'" },
  ],
  commits: [],
};

const QUESTION = "How does this application work end to end?";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript((wire) => {
  localStorage.setItem("ground.pack", wire);
}, JSON.stringify(pack));

const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://127.0.0.1:8080/app", { waitUntil: "networkidle" });
await page.waitForTimeout(500);

const card = page.locator('[data-pane="card"]');
const sayEl = card.locator("p.font-serif.text-fg").first();

await page.locator("textarea.ground-question").fill(QUESTION);
await page.locator("textarea.ground-question").press("Enter");
await page.waitForTimeout(2500);

const say = (await sayEl.count()) ? (await sayEl.innerText()).trim() : "";
const chips = await card.locator("button:has(span.font-mono)").allInnerTexts();

console.log(`PACK   ${pack.name} — ${pack.files.length} files, ${pack.commits.length} commits`);
console.log(`QUERY  "${QUESTION}"\n`);
console.log(`SAY    ${say || "(silent)"}`);
console.log(`CHIPS  ${chips.length}`);
for (const chip of chips) console.log(`   ${JSON.stringify(chip)}`);
console.log(`\nERRORS ${errors.length ? errors.join("\n") : "none"}`);

await card.screenshot({ path: `${SHOTS}architecture-card.png` });
await page.screenshot({ path: `${SHOTS}architecture-full.png` });
console.log(`shots: ${SHOTS}architecture-card.png, ${SHOTS}architecture-full.png`);
await browser.close();
