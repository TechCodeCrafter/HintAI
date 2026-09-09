/**
 * Landing film. Mp4s are not in git — local `/demo` in dev, hosted URL in prod.
 * Override with VITE_DEMO_MEDIA_BASE (no trailing slash).
 */
const HOSTED_DEMO_BASE = "https://cdn.jsdelivr.net/gh/TechCodeCrafter/HintAI@ba30b35/public/demo";

export function demoMediaUrl(filename: string): string {
  const env = (import.meta as { env?: { VITE_DEMO_MEDIA_BASE?: string; DEV?: boolean } }).env ?? {};
  const configured = String(env.VITE_DEMO_MEDIA_BASE ?? "").replace(/\/$/, "");
  if (configured) return `${configured}/${filename}`;
  if (env.DEV) return `/demo/${filename}`;
  return `${HOSTED_DEMO_BASE}/${filename}`;
}
