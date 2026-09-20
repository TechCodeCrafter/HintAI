#!/usr/bin/env node
/**
 * Regenerate public/og/meethint-og-v2.png — 1200×630 premium share card.
 * Code-drawn SVG → PNG so typography and layout stay deterministic.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = join(root, ".grok");
const svgPath = join(tmpDir, "meethint-og.svg");
const pngTmp = join(tmpDir, "meethint-og.png");
const outDir = join(root, "public/og");
const outPath = join(outDir, "meethint-og-v2.png");

mkdirSync(tmpDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#05070d"/>
      <stop offset="55%" stop-color="#0a0f1a"/>
      <stop offset="100%" stop-color="#0d1220"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#2f6bf7" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#8a4ff0" stop-opacity="0.35"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0.35">
      <stop offset="0%" stop-color="#2f6bf7"/>
      <stop offset="100%" stop-color="#8a4ff0"/>
    </linearGradient>
    <linearGradient id="cardEdge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#a855f7" stop-opacity="0.45"/>
    </linearGradient>
    <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="18" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="12" stdDeviation="24" flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <ellipse cx="920" cy="120" rx="280" ry="180" fill="url(#glow)" opacity="0.55"/>
  <ellipse cx="180" cy="520" rx="220" ry="140" fill="url(#glow)" opacity="0.35"/>

  <!-- Logo mark -->
  <g transform="translate(72,72) scale(0.72)">
    <g fill="url(#brand)" stroke="url(#brand)" stroke-width="2.5" stroke-linejoin="round">
      <path d="M9 10 L25 16 L25 26 L27.5 26 L27.5 38 L25 38 L25 48 L9 54 Z"/>
      <path d="M55 10 L39 16 L39 26 L36.5 26 L36.5 38 L39 38 L39 48 L55 54 Z"/>
    </g>
    <g fill="#dfe4ff">
      <rect x="28.8" y="28.5" width="1.4" height="7" rx="0.7"/>
      <rect x="31.3" y="26" width="1.4" height="12" rx="0.7"/>
      <rect x="33.8" y="28.5" width="1.4" height="7" rx="0.7"/>
    </g>
  </g>
  <text x="118" y="108" fill="#eef2ff" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="34" font-weight="600" letter-spacing="-0.02em">MeetHint</text>

  <!-- Left copy -->
  <text x="72" y="210" fill="#f8fafc" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="52" font-weight="700" letter-spacing="-0.03em">Know before you answer.</text>
  <text x="72" y="268" fill="#cbd5e1" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="24" font-weight="500">Real-time answers for technical conversations.</text>
  <text x="72" y="312" fill="#94a3b8" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="20" font-weight="400">Grounded in your repos, docs, and company knowledge.</text>
  <text x="72" y="368" fill="#64748b" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="16" font-weight="500" letter-spacing="0.08em">SUPPORTED · CITED · OR SILENT</text>

  <!-- Product card -->
  <g filter="url(#cardShadow)">
    <rect x="640" y="88" width="488" height="454" rx="20" fill="#0f1422" stroke="url(#cardEdge)" stroke-width="1.5"/>
    <rect x="640" y="88" width="488" height="454" rx="20" fill="none" stroke="url(#glow)" stroke-width="1" opacity="0.35"/>
  </g>

  <text x="672" y="132" fill="#64748b" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13" font-weight="600" letter-spacing="0.14em">QUESTION</text>
  <text x="672" y="178" fill="#e2e8f0" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="22" font-weight="500">Does SSO support SCIM group provisioning?</text>

  <line x1="672" y1="204" x2="1096" y2="204" stroke="#1e293b" stroke-width="1"/>

  <text x="672" y="244" fill="#64748b" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13" font-weight="600" letter-spacing="0.14em">ANSWER</text>
  <circle cx="688" cy="276" r="10" fill="#22c55e" opacity="0.2"/>
  <path d="M683 276 L686.5 279.5 L693 272" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="708" y="284" fill="#f1f5f9" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="24" font-weight="600">Yes — supported with SCIM group provisioning.</text>

  <rect x="672" y="420" width="456" height="88" rx="12" fill="#111827" stroke="#1f2937" stroke-width="1"/>
  <text x="692" y="452" fill="#94a3b8" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="14" font-weight="600">3 sources</text>

  <!-- GitHub pill -->
  <rect x="692" y="468" width="88" height="28" rx="14" fill="#1e293b"/>
  <circle cx="708" cy="482" r="7" fill="#94a3b8"/>
  <text x="722" y="487" fill="#cbd5e1" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13" font-weight="500">GitHub</text>

  <!-- Docs pill -->
  <rect x="790" y="468" width="72" height="28" rx="14" fill="#1e293b"/>
  <rect x="804" y="476" width="10" height="12" rx="1" fill="none" stroke="#94a3b8" stroke-width="1.2"/>
  <text x="822" y="487" fill="#cbd5e1" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13" font-weight="500">Docs</text>

  <!-- PDF pill -->
  <rect x="872" y="468" width="68" height="28" rx="14" fill="#1e293b"/>
  <rect x="886" y="476" width="10" height="12" rx="1" fill="#94a3b8" opacity="0.35"/>
  <text x="904" y="487" fill="#cbd5e1" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13" font-weight="500">PDF</text>
</svg>`;

writeFileSync(svgPath, svg);

const convert = spawnSync("magick", ["-density", "144", svgPath, "-resize", "1200x630!", pngTmp], {
  encoding: "utf8",
});
if (convert.status !== 0) {
  console.error(convert.stderr || convert.stdout);
  process.exit(convert.status ?? 1);
}

const handoff = spawnSync("node", ["scripts/write-atomic.mjs", pngTmp, outPath], {
  cwd: root,
  encoding: "utf8",
});
if (handoff.status !== 0) {
  console.error(handoff.stderr || handoff.stdout);
  process.exit(handoff.status ?? 1);
}

console.log(`Wrote ${outPath}`);
