/**
 * Landing film. Mp4s are restored at build time (`scripts/copy-demo-media.mjs`)
 * and served first-party from `/demo/`. Override with VITE_DEMO_MEDIA_BASE.
 */
export function demoMediaUrl(filename: string): string {
  const env = (import.meta as { env?: { VITE_DEMO_MEDIA_BASE?: string } }).env ?? {};
  const configured = String(env.VITE_DEMO_MEDIA_BASE ?? "").replace(/\/$/, "");
  if (configured) return `${configured}/${filename}`;
  return `/demo/${filename}`;
}
