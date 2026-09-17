#!/usr/bin/env node
/**
 * Resolve `VITE_APP_VERSION` for local builds and CI.
 * Vercel injects VERCEL_GIT_COMMIT_SHA at build time — prefer that over local git.
 */
import { execSync } from "node:child_process";

/**
 * @param {NodeJS.ProcessEnv} processEnv
 * @returns {string}
 */
export function resolveAppVersion(processEnv = process.env) {
  const fromEnv = processEnv.VITE_APP_VERSION?.trim();
  if (fromEnv) return fromEnv;

  const vercelSha = processEnv.VERCEL_GIT_COMMIT_SHA?.trim();
  if (vercelSha) return vercelSha.length > 7 ? vercelSha.slice(0, 7) : vercelSha;

  const gitSha = processEnv.GIT_COMMIT?.trim();
  if (gitSha) return gitSha.length > 7 ? gitSha.slice(0, 7) : gitSha;

  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "dev";
  }
}
