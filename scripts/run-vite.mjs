#!/usr/bin/env node
/**
 * Start Vite through with-app-env.mjs on the port in scripts/ports.mjs.
 * `dev` and `preview:e2e` must not hardcode a second copy of that number.
 */
import { spawn } from "node:child_process";
import { DEV_PORT, PREVIEW_PORT } from "./ports.mjs";

const mode = process.argv[2];
const args = ["scripts/with-app-env.mjs", "vite"];
if (mode === "dev") {
  args.push("dev", "--host", "0.0.0.0", "--port", String(DEV_PORT));
} else if (mode === "preview") {
  args.push("preview");
} else if (mode === "preview:e2e") {
  args.push("preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort");
} else {
  console.error("usage: node scripts/run-vite.mjs dev|preview|preview:e2e");
  process.exit(1);
}

const child = spawn(process.execPath, args, { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
