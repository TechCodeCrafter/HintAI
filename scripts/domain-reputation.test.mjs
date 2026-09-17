import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { injectGrokPwaHead } from "./grok-pwa-shared.mjs";
import {
  assertCspNotPermissive,
  buildAppCsp,
  buildMarketingCsp,
  buildSecurityHeaders,
  isProductionTrustHost,
  shouldInjectGrokBuilderChrome,
} from "./security-headers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

const TRUST_ROUTES = ["/privacy", "/terms", "/security", "/contact"];
const FOOTER_TRUST_HREFS = ["/privacy", "/terms", "/security", "/contact"];

test("shouldInjectGrokBuilderChrome gates grok.com scripts to approved hosts", () => {
  assert.equal(shouldInjectGrokBuilderChrome("www.meethint.ai"), false);
  assert.equal(shouldInjectGrokBuilderChrome("meethint.ai"), false);
  assert.equal(shouldInjectGrokBuilderChrome("wild-race.grok.me"), true);
  assert.equal(shouldInjectGrokBuilderChrome("localhost"), false);
  const prev = process.env.VITE_GROK_BUILDER_CHROME;
  process.env.VITE_GROK_BUILDER_CHROME = "1";
  try {
    assert.equal(shouldInjectGrokBuilderChrome("localhost"), true);
  } finally {
    if (prev === undefined) delete process.env.VITE_GROK_BUILDER_CHROME;
    else process.env.VITE_GROK_BUILDER_CHROME = prev;
  }
});

test("production-rendered HTML has no grok.com executable script references", () => {
  const html = "<html><head><title>MeetHint</title></head><body></body></html>";
  for (const host of ["meethint.ai", "www.meethint.ai"]) {
    const out = injectGrokPwaHead(html, { host, projectId: "x", creator: "@a", creatorId: "1" });
    assert.doesNotMatch(out, /https:\/\/grok\.com\/[^"'\s>]+\.js/);
    assert.doesNotMatch(out, /grok-app-builder\/extensions\.js/);
  }
});

test("trust route modules exist and are registered", () => {
  const tree = read("src/routeTree.gen.ts");
  for (const route of TRUST_ROUTES) {
    const file = `src/routes${route}.tsx`;
    assert.ok(existsSync(join(ROOT, file)), `${file} must exist`);
    assert.match(tree, new RegExp(`'${route.replace("/", "\\/")}'`));
  }
});

test("security.txt exists with required fields and working contacts", () => {
  const text = read("public/.well-known/security.txt");
  assert.match(text, /^Contact:/m);
  assert.match(text, /^Preferred-Languages:/m);
  assert.match(text, /^Canonical:/m);
  assert.match(text, /^Expires:/m);
  assert.match(text, /github\.com\/TechCodeCrafter\/HintAI\/security\/advisories\/new/);
  assert.doesNotMatch(text, /^Contact: mailto:security@meethint\.ai/m);
});

test("landing footer trust links point to real routes", () => {
  const landing = read("src/components/meethint-landing.tsx");
  for (const href of FOOTER_TRUST_HREFS) {
    assert.match(landing, new RegExp(`href="${href.replace("/", "\\/")}"`));
  }
  assert.doesNotMatch(landing, /href="#security"/);
  assert.doesNotMatch(landing, />\s*Privacy\s*<[\s\S]*href="#/);
});

test("root document does not load Google Fonts", () => {
  const root = read("src/routes/__root.tsx");
  assert.doesNotMatch(root, /fonts\.googleapis\.com/);
  assert.doesNotMatch(root, /fonts\.gstatic\.com/);
  assert.match(root, /fonts\.css/);
});

test("baseline security headers are defined for production hosts", () => {
  const headers = buildSecurityHeaders({ host: "www.meethint.ai", pathname: "/" });
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.match(headers["Permissions-Policy"], /camera=\(\)/);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.ok(headers["Content-Security-Policy"]);
  assertCspNotPermissive(headers["Content-Security-Policy"]);
});

test("landing uses app CSP because it boots the shared SPA shell", () => {
  const csp = buildSecurityHeaders({ host: "www.meethint.ai", pathname: "/" })["Content-Security-Policy"];
  assert.match(csp, /wasm-unsafe-eval/);
});

test("trust legal pages keep strict marketing CSP", () => {
  for (const path of TRUST_ROUTES) {
    const csp = buildSecurityHeaders({ host: "www.meethint.ai", pathname: path })["Content-Security-Policy"];
    assert.doesNotMatch(csp, /wasm-unsafe-eval/);
    assert.match(csp, /style-src 'self'/);
  }
});

test("marketing CSP stays first-party on meethint.ai landing", () => {
  const csp = buildMarketingCsp();
  assert.match(csp, /font-src 'self' data:/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.doesNotMatch(csp, /style-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /script-src[^;]*\*/);
  assert.doesNotMatch(csp, /grok\.com/);
  assert.doesNotMatch(csp, /fonts\.googleapis\.com/);
  assert.doesNotMatch(csp, /jsdelivr/);
  assertCspNotPermissive(csp);
});

test("theme applies after mount in root document (no sync pre-hydrate script)", () => {
  const root = read("src/routes/__root.tsx");
  assert.match(root, /applyDocumentTheme/);
  assert.doesNotMatch(root, /src="\/theme-boot\.js"/);
  assert.doesNotMatch(root, /dangerouslySetInnerHTML/);
});

test("app CSP allows only documented third-party connect targets", () => {
  const csp = buildAppCsp();
  assert.match(csp, /font-src 'self' data:/);
  assert.match(csp, /connect-src[^;]*https:\/\/api\.openai\.com/);
  assert.doesNotMatch(csp, /jsdelivr/);
  assert.doesNotMatch(csp, /script-src[^;]*\*/);
  assert.doesNotMatch(csp, /grok\.com/);
  assertCspNotPermissive(csp);
});

test("contact and trust pages do not advertise inactive mailboxes", () => {
  for (const file of ["src/routes/contact.tsx", "src/routes/privacy.tsx", "src/routes/security.tsx"]) {
    const text = read(file);
    assert.doesNotMatch(text, /mailto:security@meethint\.ai/);
    assert.doesNotMatch(text, /mailto:abuse@meethint\.ai/);
  }
});

test("nitro security headers middleware is wired", () => {
  const middleware = read("server/middleware/0-security-headers.ts");
  assert.match(middleware, /applySecurityHeaders/);
  const vite = read("vite.config.ts");
  assert.match(vite, /securityHeadersPlugin/);
  assert.match(vite, /serverDir:\s*"\.\/server"/);
});

test("production trust host detection", () => {
  assert.equal(isProductionTrustHost("www.meethint.ai"), true);
  assert.equal(isProductionTrustHost("meethint.ai:443"), true);
  assert.equal(isProductionTrustHost("wild-race.grok.me"), false);
});
