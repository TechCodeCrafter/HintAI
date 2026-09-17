function env(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

export type DeployBuildInfo = {
  /** Short git SHA baked into the client bundle (`VITE_APP_VERSION`). */
  appVersion: string;
  /** Full commit SHA from the deploy platform, when available. */
  commitSha: string | null;
  /** Deploy git ref (e.g. `main`). */
  commitRef: string | null;
  /** Vercel deployment id from runtime, when on Vercel. */
  vercelDeploymentId: string | null;
  /** ISO timestamp when the server module loaded (not build time). */
  checkedAt: string;
};

function shortSha(full: string): string {
  return full.length > 7 ? full.slice(0, 7) : full;
}

/** Resolve deploy metadata for `/api/deploy/status` and diagnostics. */
export function readDeployBuildInfo(): DeployBuildInfo {
  const commitSha = env("VERCEL_GIT_COMMIT_SHA") ?? env("GIT_COMMIT") ?? null;
  const viteVersion = env("VITE_APP_VERSION");
  const appVersion =
    (viteVersion && viteVersion !== "dev" ? viteVersion : null) ??
    (commitSha ? shortSha(commitSha) : "dev");

  return {
    appVersion,
    commitSha,
    commitRef: env("VERCEL_GIT_COMMIT_REF") ?? env("GIT_BRANCH") ?? null,
    vercelDeploymentId: env("VERCEL_DEPLOYMENT_ID") ?? null,
    checkedAt: new Date().toISOString(),
  };
}
