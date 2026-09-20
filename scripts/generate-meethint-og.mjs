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
    <clipPath id="cardClip">
      <rect x="592" y="96" width="560" height="438" rx="20"/>
    </clipPath>
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

  <!-- Left copy — keep within ~540px so the card never overlaps headline -->
  <text x="56" y="200" fill="#f8fafc" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="46" font-weight="700" letter-spacing="-0.03em">
    <tspan x="56" dy="0">Know before</tspan>
    <tspan x="56" dy="54">you answer.</tspan>
  </text>
  <text x="56" y="330" fill="#cbd5e1" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="22" font-weight="500">
    <tspan x="56" dy="0">Real-time answers for</tspan>
    <tspan x="56" dy="30">technical conversations.</tspan>
  </text>
  <text x="56" y="404" fill="#94a3b8" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="18" font-weight="400">
    <tspan x="56" dy="0">Grounded in your repos, docs,</tspan>
    <tspan x="56" dy="26">and company knowledge.</tspan>
  </text>
  <text x="56" y="468" fill="#64748b" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="14" font-weight="500" letter-spacing="0.08em">SUPPORTED · CITED · OR SILENT</text>

  <!-- Product card — 48px safe margin on right (592 + 560 = 1152) -->
  <g filter="url(#cardShadow)">
    <rect x="592" y="96" width="560" height="438" rx="20" fill="#0f1422" stroke="url(#cardEdge)" stroke-width="1.5"/>
    <rect x="592" y="96" width="560" height="438" rx="20" fill="none" stroke="url(#glow)" stroke-width="1" opacity="0.35"/>
  </g>

  <g clip-path="url(#cardClip)">
    <text x="624" y="136" fill="#64748b" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13" font-weight="600" letter-spacing="0.14em">QUESTION</text>
    <text x="624" y="172" fill="#e2e8f0" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="20" font-weight="500">
      <tspan x="624" dy="0">Does SSO support SCIM group</tspan>
      <tspan x="624" dy="28">provisioning?</tspan>
    </text>

    <line x1="624" y1="214" x2="1120" y2="214" stroke="#1e293b" stroke-width="1"/>

    <text x="624" y="248" fill="#64748b" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13" font-weight="600" letter-spacing="0.14em">ANSWER</text>
    <circle cx="636" cy="282" r="10" fill="#22c55e" opacity="0.2"/>
    <path d="M631 282 L634.5 285.5 L641 278" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="656" y="290" fill="#f1f5f9" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="20" font-weight="600">
      <tspan x="656" dy="0">Yes — supported with SCIM group</tspan>
      <tspan x="656" dy="28">provisioning.</tspan>
    </text>

    <rect x="624" y="368" width="496" height="88" rx="12" fill="#111827" stroke="#1f2937" stroke-width="1"/>
    <text x="644" y="400" fill="#94a3b8" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="14" font-weight="600">3 sources</text>

    <rect x="644" y="416" width="88" height="28" rx="14" fill="#1e293b"/>
    <circle cx="660" cy="430" r="7" fill="#94a3b8"/>
    <text x="674" y="435" fill="#cbd5e1" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13" font-weight="500">GitHub</text>

    <rect x="742" y="416" width="72" height="28" rx="14" fill="#1e293b"/>
    <rect x="756" y="424" width="10" height="12" rx="1" fill="none" stroke="#94a3b8" stroke-width="1.2"/>
    <text x="774" y="435" fill="#cbd5e1" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13" font-weight="500">Docs</text>

    <rect x="824" y="416" width="68" height="28" rx="14" fill="#1e293b"/>
    <rect x="838" y="424" width="10" height="12" rx="1" fill="#94a3b8" opacity="0.35"/>
    <text x="856" y="435" fill="#cbd5e1" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13" font-weight="500">PDF</text>
  </g>
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
