#!/usr/bin/env node
/**
 * Regenerate public/og/meethint-og-v3.png — 1200×630 premium share card.
 * Embeds the official mark from public/favicon.svg (same geometry as MeetHintMark).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = join(root, ".grok");
const svgPath = join(tmpDir, "meethint-og.svg");
const pngTmp = join(tmpDir, "meethint-og.png");
const outDir = join(root, "public/og");
const outPath = join(outDir, "meethint-og-v3.png");

const BRAND = {
  blue: "#2f6bf7",
  violet: "#8a4ff0",
  signal: "#dfe4ff",
  canvas: "#05070d",
  card: "#0f1422",
  text: "#f1f5f9",
  muted: "#94a3b8",
  dim: "#64748b",
  success: "#4ade80",
};

function fontFace(family, weight, fileName) {
  const path = join(root, "node_modules/@fontsource/ibm-plex-sans/files", fileName);
  if (!existsSync(path)) return "";
  return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url('${pathToFileURL(path).href}') format('woff2');}`;
}

const fontCss = [
  fontFace("IBM Plex Sans", 400, "ibm-plex-sans-latin-400-normal.woff2"),
  fontFace("IBM Plex Sans", 500, "ibm-plex-sans-latin-500-normal.woff2"),
  fontFace("IBM Plex Sans", 600, "ibm-plex-sans-latin-600-normal.woff2"),
  fontFace("IBM Plex Sans", 700, "ibm-plex-sans-latin-700-normal.woff2"),
].join("");

const sans = "'IBM Plex Sans', Helvetica Neue, Helvetica, Arial, sans-serif";

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <style><![CDATA[${fontCss}]]></style>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BRAND.canvas}"/>
      <stop offset="50%" stop-color="#0a0f1a"/>
      <stop offset="100%" stop-color="#0d1220"/>
    </linearGradient>
    <radialGradient id="heroGlow" cx="78%" cy="28%" r="55%">
      <stop offset="0%" stop-color="${BRAND.violet}" stop-opacity="0.28"/>
      <stop offset="55%" stop-color="${BRAND.blue}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${BRAND.canvas}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cardEdge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BRAND.blue}" stop-opacity="0.65"/>
      <stop offset="100%" stop-color="${BRAND.violet}" stop-opacity="0.5"/>
    </linearGradient>
    <filter id="cardShadow" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="0" dy="16" stdDeviation="28" flood-color="#000" flood-opacity="0.55"/>
    </filter>
    <clipPath id="cardClip">
      <rect x="588" y="92" width="564" height="446" rx="22"/>
    </clipPath>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#heroGlow)"/>

  <!-- Official mark composited from public/favicon.svg after rasterize -->
  <text x="136" y="92" fill="${BRAND.text}" font-family="${sans}" font-size="32" font-weight="600" letter-spacing="-0.02em">MeetHint</text>

  <text x="56" y="188" fill="${BRAND.text}" font-family="${sans}" font-size="44" font-weight="700" letter-spacing="-0.03em">Know before</text>
  <text x="56" y="242" fill="${BRAND.violet}" font-family="${sans}" font-size="44" font-weight="700" letter-spacing="-0.03em">you answer.</text>

  <text x="56" y="296" fill="#cbd5e1" font-family="${sans}" font-size="21" font-weight="500">
    <tspan x="56" dy="0">Real-time, evidence-backed answers</tspan>
    <tspan x="56" dy="30">for technical conversations.</tspan>
  </text>
  <text x="56" y="378" fill="${BRAND.muted}" font-family="${sans}" font-size="17" font-weight="400">
    <tspan x="56" dy="0">Grounded in your repos, docs,</tspan>
    <tspan x="56" dy="26">and company knowledge.</tspan>
  </text>

  <line x1="56" y1="448" x2="520" y2="448" stroke="#1e293b" stroke-width="1"/>
  <text x="56" y="478" fill="${BRAND.dim}" font-family="${sans}" font-size="13" font-weight="600" letter-spacing="0.12em">SUPPORTED · CITED · OR SILENT</text>

  <g filter="url(#cardShadow)">
    <rect x="588" y="92" width="564" height="446" rx="22" fill="${BRAND.card}" stroke="url(#cardEdge)" stroke-width="1.5"/>
  </g>
  <g clip-path="url(#cardClip)">
    <text x="664" y="130" fill="${BRAND.muted}" font-family="${sans}" font-size="14" font-weight="600">MeetHint</text>
    <circle cx="738" cy="124" r="5" fill="${BRAND.success}"/>
    <text x="750" y="129" fill="${BRAND.success}" font-family="${sans}" font-size="13" font-weight="600">Live</text>

    <rect x="620" y="152" width="500" height="72" rx="12" fill="#111827" stroke="#1f2937" stroke-width="1"/>
    <text x="636" y="176" fill="${BRAND.dim}" font-family="${sans}" font-size="11" font-weight="600" letter-spacing="0.14em">QUESTION</text>
    <text x="636" y="204" fill="#e2e8f0" font-family="${sans}" font-size="18" font-weight="500">
      <tspan x="636" dy="0">Does SSO support SCIM group</tspan>
      <tspan x="636" dy="24">provisioning?</tspan>
    </text>

    <rect x="620" y="240" width="500" height="96" rx="12" fill="#0d2818" stroke="#14532d" stroke-width="1"/>
    <text x="636" y="264" fill="${BRAND.dim}" font-family="${sans}" font-size="11" font-weight="600" letter-spacing="0.14em">ANSWER</text>
    <circle cx="648" cy="292" r="10" fill="${BRAND.success}" opacity="0.25"/>
    <path d="M643 292 L646.5 295.5 L653 288" fill="none" stroke="${BRAND.success}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="668" y="300" fill="${BRAND.text}" font-family="${sans}" font-size="18" font-weight="600">
      <tspan x="668" dy="0">Yes — supported with SCIM group</tspan>
      <tspan x="668" dy="26">provisioning.</tspan>
    </text>

    <rect x="620" y="356" width="500" height="88" rx="12" fill="#111827" stroke="#1f2937" stroke-width="1"/>
    <text x="640" y="388" fill="${BRAND.muted}" font-family="${sans}" font-size="13" font-weight="600">3 sources</text>
    <text x="1096" y="388" text-anchor="end" fill="${BRAND.dim}" font-family="${sans}" font-size="12" font-weight="500">View all →</text>

    <rect x="640" y="404" width="88" height="28" rx="14" fill="#1e293b"/>
    <circle cx="656" cy="418" r="7" fill="${BRAND.muted}"/>
    <text x="670" y="423" fill="#cbd5e1" font-family="${sans}" font-size="12" font-weight="500">GitHub</text>

    <rect x="738" y="404" width="72" height="28" rx="14" fill="#1e293b"/>
    <rect x="752" y="412" width="10" height="12" rx="1" fill="none" stroke="${BRAND.muted}" stroke-width="1.2"/>
    <text x="770" y="423" fill="#cbd5e1" font-family="${sans}" font-size="12" font-weight="500">Docs</text>

    <rect x="820" y="404" width="68" height="28" rx="14" fill="#1e293b"/>
    <rect x="834" y="412" width="10" height="12" rx="1" fill="${BRAND.muted}" opacity="0.35"/>
    <text x="852" y="423" fill="#cbd5e1" font-family="${sans}" font-size="12" font-weight="500">PDF</text>
  </g>
</svg>`;

mkdirSync(tmpDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(svgPath, svg);

const convert = spawnSync("magick", ["-density", "144", svgPath, "-resize", "1200x630!", pngTmp], {
  encoding: "utf8",
});
if (convert.status !== 0) {
  console.error(convert.stderr || convert.stdout);
  process.exit(convert.status ?? 1);
}

/** Composite the official favicon.svg — raster paths ImageMagick renders reliably. */
function compositeOfficialMark(basePng, outPng) {
  const favicon = join(root, "public/favicon.svg");
  const lockup = join(tmpDir, "mark-lockup.png");
  const card = join(tmpDir, "mark-card.png");
  for (const [cmd, label] of [
    [["magick", favicon, "-background", "none", "-density", "240", "-resize", "72x72", lockup], "lockup mark"],
    [["magick", favicon, "-background", "none", "-density", "240", "-resize", "36x36", card], "card mark"],
  ]) {
    const step = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
    if (step.status !== 0) {
      console.error(`Failed to rasterize ${label}:`, step.stderr || step.stdout);
      process.exit(step.status ?? 1);
    }
  }
  const composite = spawnSync(
    "magick",
    [
      basePng,
      lockup,
      "-geometry",
      "+52+38",
      "-composite",
      card,
      "-geometry",
      "+618+104",
      "-composite",
      outPng,
    ],
    { encoding: "utf8" },
  );
  if (composite.status !== 0) {
    console.error(composite.stderr || composite.stdout);
    process.exit(composite.status ?? 1);
  }
}

compositeOfficialMark(pngTmp, pngTmp);

const handoff = spawnSync("node", ["scripts/write-atomic.mjs", pngTmp, outPath], {
  cwd: root,
  encoding: "utf8",
});
if (handoff.status !== 0) {
  console.error(handoff.stderr || handoff.stdout);
  process.exit(handoff.status ?? 1);
}

console.log(`Wrote ${outPath}`);
