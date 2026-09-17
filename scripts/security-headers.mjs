// @ts-nocheck
/**
 * Production security headers and CSP for meethint.ai (Phase A — ticket #25).
 * Shared by Nitro middleware, preview middleware, and regression tests.
 */

export const PRODUCTION_TRUST_HOSTS = new Set(["meethint.ai", "www.meethint.ai"]);

/** Legal/marketing document paths — strict CSP (no wasm). Landing `/` is excluded: it runs the full SPA shell. */
const TRUST_PATHS = new Set(["/privacy", "/terms", "/security", "/contact"]);

/** Hostnames where Grok App Builder chrome (extensions.js) may load. */
export function shouldInjectGrokBuilderChrome(hostHeader) {
  const host = parseHost(hostHeader);
  if (!host) return false;
  if (PRODUCTION_TRUST_HOSTS.has(host)) return false;
  if (host === "grok.me" || host.endsWith(".grok.me")) return true;
  if (host === "localhost" || host === "127.0.0.1") {
    return process.env.VITE_GROK_BUILDER_CHROME === "1";
  }
  return false;
}

export function parseHost(hostHeader) {
  return String(hostHeader ?? "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
}

export function isProductionTrustHost(hostHeader) {
  return PRODUCTION_TRUST_HOSTS.has(parseHost(hostHeader));
}

export function isTrustSurfacePath(pathname) {
  const path = String(pathname ?? "").split("?", 1)[0] || "/";
  return TRUST_PATHS.has(path);
}

/** Document paths (SPA routes) vs static assets — for Cache-Control on HTML shells. */
export function isLikelyHtmlDocumentPath(pathname) {
  const path = String(pathname ?? "").split("?", 1)[0] || "/";
  return (
    !path.startsWith("/__grok/") &&
    !path.startsWith("/api/") &&
    !path.startsWith("/assets/") &&
    !/\.[a-z0-9]+$/i.test(path)
  );
}

/**
 * Marketing / legal surfaces: strict first-party CSP (no third-party executables).
 * script-src keeps 'unsafe-inline' for TanStack Start `$tsr-stream-barrier` only
 * (theme boot is external `/theme-boot.js`). Styles are external CSS only.
 */
export function buildMarketingCsp() {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
  ];
  return directives.join("; ");
}

/**
 * App surfaces (/app, /home, …): still blocks grok.com; allows ML + provider APIs.
 */
export function buildAppCsp() {
  const connect = [
    "'self'",
    "https://api.openai.com",
    "https://api.anthropic.com",
    "https://api.x.ai",
    "https://huggingface.co",
    "https://cdn-lfs.huggingface.co",
  ];
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
  ];
  return directives.join("; ");
}

export function buildContentSecurityPolicy({ host, pathname } = {}) {
  if (isProductionTrustHost(host) && isTrustSurfacePath(pathname)) {
    return buildMarketingCsp();
  }
  return buildAppCsp();
}

export function buildSecurityHeaders(options = {}) {
  const { host, pathname, includeCsp = true } = options;
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), geolocation=(), microphone=(self), payment=(), usb=()",
    "X-Frame-Options": "DENY",
  };
  if (includeCsp) {
    headers["Content-Security-Policy"] = buildContentSecurityPolicy({ host, pathname });
  }
  return headers;
}

/** Fail build/tests if CSP regresses to wildcard script-src. */
export function assertCspNotPermissive(csp) {
  const text = String(csp ?? "");
  if (/\bscript-src\s+[^;]*\*/.test(text)) {
    throw new Error("CSP script-src must not use wildcard *");
  }
  if (/\bscript-src\s+[^;]*\*[^;]*'unsafe-eval'/.test(text)) {
    throw new Error("CSP must not combine script-src * with unsafe-eval");
  }
  if (/https:\/\/grok\.com/.test(text)) {
    throw new Error("CSP must not allow grok.com scripts on production surfaces");
  }
}

/** HTML documents carry hashed asset refs — revalidate so deploys don't stale-hydrate. */
export function htmlDocumentCacheControl() {
  return "no-cache";
}

export function applySecurityHeaders(responseHeaders, options = {}) {
  const { isHtmlDocument = false } = options;
  for (const [key, value] of Object.entries(buildSecurityHeaders(options))) {
    if (typeof responseHeaders.set === "function") {
      responseHeaders.set(key, value);
    } else if (typeof responseHeaders.setHeader === "function") {
      responseHeaders.setHeader(key, value);
    }
  }
  if (isHtmlDocument) {
    const cacheControl = htmlDocumentCacheControl();
    if (typeof responseHeaders.set === "function") {
      responseHeaders.set("Cache-Control", cacheControl);
    } else if (typeof responseHeaders.setHeader === "function") {
      responseHeaders.setHeader("Cache-Control", cacheControl);
    }
  }
}
