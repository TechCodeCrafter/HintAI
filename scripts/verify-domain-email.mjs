#!/usr/bin/env node
/**
 * Manual / ops DNS + security.txt verification for meethint.ai (Ticket #25 Phase B).
 * Default profile is **launch** (Namecheap forwarding — zero/near-zero cost).
 *
 *   npm run verify:domain-email
 *   npm run verify:domain-email -- --provider launch
 *   npm run verify:domain-email -- --provider google   # paid upgrade check
 *   npm run verify:domain-email -- --expect-mail --json
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resolver } from "node:dns/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DOMAIN = "meethint.ai";
const SECURITY_TXT_URL = "https://www.meethint.ai/.well-known/security.txt";

const TARGET = JSON.parse(readFileSync(join(ROOT, "config/mail-contacts.json"), "utf8"));

const PROVIDERS = {
  launch: {
    label: "Namecheap Email Forwarding (launch)",
    spfIncludes: ["spf.efwd.registrar-servers.com"],
    mxMustMatch: /eforward\d+\.registrar-servers\.com$/,
    dkimRequired: false,
    caaRequired: true,
    dnssecRequired: false,
    securityTxtRequired: false,
  },
  google: {
    label: "Google Workspace (paid upgrade)",
    spfIncludes: ["_spf.google.com"],
    mxSuffixes: [".google.com", ".googlemail.com"],
    mxRejectForwarding: true,
    dkimRequired: true,
    dkimSelector: "google",
    caaRequired: true,
    dnssecRequired: false,
    securityTxtRequired: false,
  },
  cloudflare: {
    label: "Cloudflare Email Routing (paid upgrade path)",
    spfIncludes: ["_spf.mx.cloudflare.net"],
    mxHosts: ["route1.mx.cloudflare.net", "route2.mx.cloudflare.net", "route3.mx.cloudflare.net"],
    mxRejectForwarding: true,
    dkimRequired: false,
    caaRequired: true,
    dnssecRequired: false,
    securityTxtRequired: false,
  },
};

function parseArgs(argv) {
  const args = {
    domain: DEFAULT_DOMAIN,
    expectMail: false,
    json: false,
    provider: TARGET.launchProfile ?? "launch",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--expect-mail") args.expectMail = true;
    else if (a === "--json") args.json = true;
    else if (a === "--domain") args.domain = argv[++i] ?? DEFAULT_DOMAIN;
    else if (a === "--provider") args.provider = argv[++i] ?? "launch";
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node scripts/verify-domain-email.mjs [--domain meethint.ai] [--provider launch|google|cloudflare] [--expect-mail] [--json]",
      );
      process.exit(0);
    }
  }
  return args;
}

function unwrapTxt(records) {
  return records.flatMap((row) => row).map((s) => s.replace(/^"|"$/g, ""));
}

async function queryTxt(resolver, name) {
  try {
    return unwrapTxt(await resolver.resolveTxt(name));
  } catch (err) {
    if (err?.code === "ENODATA" || err?.code === "ENOTFOUND") return [];
    throw err;
  }
}

async function queryMx(resolver, name) {
  try {
    return await resolver.resolveMx(name);
  } catch (err) {
    if (err?.code === "ENODATA" || err?.code === "ENOTFOUND") return [];
    throw err;
  }
}

async function queryCaa(resolver, name) {
  try {
    return await resolver.resolve(name, "CAA");
  } catch (err) {
    if (err?.code === "ENODATA" || err?.code === "ENOTFOUND") return [];
    throw err;
  }
}

function parseSpf(txtRecords) {
  return txtRecords.filter((t) => t.toLowerCase().startsWith("v=spf1"));
}

function checkSpf(spfRecords, providerSpec) {
  const issues = [];
  const warnings = [];
  if (spfRecords.length === 0) issues.push("No SPF TXT record found.");
  if (spfRecords.length > 1) issues.push(`Expected exactly one SPF record, found ${spfRecords.length}.`);
  const spf = spfRecords[0] ?? "";
  if (/\s\+all\b/i.test(spf)) issues.push("SPF uses +all (too permissive).");
  if (!/\s~all\b|\s-all\b/i.test(spf)) {
    issues.push("SPF should end with ~all (launch) or -all (strict authenticated outbound).");
  }
  for (const inc of providerSpec.spfIncludes ?? []) {
    if (!spf.includes(inc)) issues.push(`SPF missing include:${inc} for ${providerSpec.label}.`);
  }
  if (providerSpec.spfIncludes?.includes("_spf.google.com") && spf.includes("spf.efwd.registrar-servers.com")) {
    issues.push("SPF still includes Namecheap forwarding — remove when on Google Workspace.");
  }
  if (providerSpec.spfIncludes?.includes("spf.efwd.registrar-servers.com") && spf.includes("_spf.google.com")) {
    warnings.push("SPF includes Google — OK for paid tier, not needed on launch forwarding.");
  }
  return { spf, issues, warnings };
}

function checkMx(mxRecords, providerSpec) {
  const issues = [];
  const warnings = [];
  if (mxRecords.length === 0) issues.push("No MX records found.");
  const hosts = mxRecords.map((r) => r.exchange.toLowerCase());

  if (providerSpec.mxMustMatch) {
    const ok = hosts.some((h) => providerSpec.mxMustMatch.test(h));
    if (!ok) {
      issues.push(`MX must include Namecheap eforward hosts (eforward*.registrar-servers.com) for launch forwarding.`);
    }
  }
  if (providerSpec.mxRejectForwarding && hosts.some((h) => h.includes("eforward"))) {
    issues.push("MX still points to Namecheap eforward — replace with mail provider MX for paid tier.");
  }
  if (providerSpec.mxHosts) {
    const ok = providerSpec.mxHosts.some((want) => hosts.includes(want));
    if (!ok) issues.push(`MX does not include expected hosts (${providerSpec.mxHosts.join(", ")}).`);
  }
  if (providerSpec.mxSuffixes) {
    const ok = hosts.some((h) => providerSpec.mxSuffixes.some((s) => h.endsWith(s)));
    if (!ok) issues.push(`MX does not match ${providerSpec.label} (${providerSpec.mxSuffixes.join(" / ")}).`);
  }
  return { hosts, issues, warnings };
}

async function checkDkim(resolver, domain, providerSpec) {
  if (!providerSpec.dkimRequired) {
    return {
      name: "(deferred)",
      records: [],
      issues: [],
      warnings: [
        "DKIM deferred at launch — Namecheap forwarding does not sign outbound @meethint.ai mail.",
        "Do not send production transactional/support mail From @meethint.ai until a paid provider enables DKIM.",
      ],
      deferred: true,
    };
  }
  const selector = providerSpec.dkimSelector ?? TARGET.dkimSelector;
  if (!selector) return { issues: ["DKIM required but no selector configured."], warnings: [], deferred: false };
  const name = `${selector}._domainkey.${domain}`;
  const txt = await queryTxt(resolver, name);
  const issues = [];
  if (txt.length === 0) {
    issues.push(`No DKIM TXT at ${name} (enable DKIM in mail provider admin).`);
  }
  return { name, records: txt, issues, warnings: [], deferred: false };
}

async function checkDmarc(resolver, domain) {
  const name = `_dmarc.${domain}`;
  const txt = await queryTxt(resolver, name);
  const issues = [];
  if (txt.length === 0) {
    issues.push(`No DMARC record at _dmarc.${domain}.`);
    return { records: [], issues, warnings: [] };
  }
  const record = txt.find((t) => t.toLowerCase().startsWith("v=dmarc1")) ?? txt[0];
  if (!/^v=DMARC1/i.test(record)) issues.push("DMARC record missing v=DMARC1 tag.");
  if (!/\bp=none\b/i.test(record)) issues.push("DMARC should use p=none at launch until DKIM alignment is verified.");
  if (/\bp=reject\b/i.test(record)) issues.push("DMARC p=reject is too aggressive without DKIM on launch forwarding.");
  return { record, issues, warnings: [] };
}

function checkCaa(caaRecords, providerSpec) {
  const issues = [];
  const warnings = [];
  if (caaRecords.length === 0) {
    const msg = 'No CAA records — add 0 issue "letsencrypt.org" at apex for Vercel TLS renewal.';
    if (providerSpec.caaRequired) issues.push(msg);
    else warnings.push(msg);
    return { issues, warnings, records: [] };
  }
  const flat = caaRecords.map((r) => {
    const flag = r.critical ? "1" : "0";
    if (r.issue) return `${flag} issue "${r.issue}"`;
    if (r.issuewild) return `${flag} issuewild "${r.issuewild}"`;
    if (r.iodef) return `${flag} iodef "${r.iodef}"`;
    return flag;
  });
  const allowsLetsEncrypt = caaRecords.some(
    (r) => r.issue === "letsencrypt.org" || r.issuewild === "letsencrypt.org",
  );
  if (!allowsLetsEncrypt) {
    issues.push('CAA present but missing 0 issue "letsencrypt.org" — Vercel cert renewal may fail.');
  }
  return { records: flat, issues, warnings };
}

async function checkDnssec(resolver, domain, providerSpec) {
  const issues = [];
  const warnings = [];
  let ds = [];
  try {
    ds = await resolver.resolve(domain, "DS");
  } catch {
    ds = [];
  }
  if (ds.length === 0) {
    const msg = "No DS record at registry (DNSSEC not enabled or not propagated).";
    if (providerSpec.dnssecRequired) issues.push(msg);
    else warnings.push(msg);
  }
  return { dsCount: ds.length, issues, warnings };
}

async function fetchSecurityTxt(providerSpec) {
  const issues = [];
  const warnings = [];
  try {
    const res = await fetch(SECURITY_TXT_URL, { redirect: "follow" });
    if (!res.ok) {
      const msg = `security.txt HTTP ${res.status} at ${SECURITY_TXT_URL}`;
      if (providerSpec.securityTxtRequired) issues.push(msg);
      else warnings.push(msg);
      return { body: "", issues, warnings };
    }
    const body = await res.text();
    if (!/^Contact:/m.test(body)) issues.push("security.txt missing Contact: line.");
    if (!/^Expires:/m.test(body)) issues.push("security.txt missing Expires: line.");
    if (TARGET.verified) {
      if (!body.includes(`mailto:${TARGET.securityEmail}`)) {
        issues.push(`security.txt missing mailto:${TARGET.securityEmail} (config says verified).`);
      }
    } else if (/^Contact: mailto:security@meethint\.ai/m.test(body)) {
      issues.push("security.txt advertises security@ before mail-contacts.json verified=true.");
    }
    return { body, issues, warnings };
  } catch (err) {
    const msg = `Could not fetch security.txt: ${err.message}`;
    if (providerSpec.securityTxtRequired) issues.push(msg);
    else warnings.push(msg);
    return { body: "", issues, warnings };
  }
}

function section(name, detail, issues, warnings, required) {
  const ok = issues.length === 0;
  return { name, detail, issues, warnings, ok, required };
}

async function main() {
  const args = parseArgs(process.argv);
  const providerSpec = PROVIDERS[args.provider] ?? PROVIDERS.launch;
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);

  const txt = await queryTxt(resolver, args.domain);
  const spf = checkSpf(parseSpf(txt), providerSpec);
  const mx = checkMx(await queryMx(resolver, args.domain), providerSpec);
  const dkim = await checkDkim(resolver, args.domain, providerSpec);
  const dmarc = await checkDmarc(resolver, args.domain);
  const caa = checkCaa(await queryCaa(resolver, args.domain), providerSpec);
  const dnssec = await checkDnssec(resolver, args.domain, providerSpec);
  const securityTxt = await fetchSecurityTxt(providerSpec);

  const sections = [
    section("SPF", spf.spf || "(none)", spf.issues, spf.warnings, true),
    section("MX", mx.hosts.join(", ") || "(none)", mx.issues, mx.warnings, true),
    section("DKIM", dkim.name ?? "(n/a)", dkim.issues, dkim.warnings, providerSpec.dkimRequired),
    section("DMARC", dmarc.record ?? "(none)", dmarc.issues, dmarc.warnings, true),
    section("CAA", (caa.records ?? []).join("; ") || "(none)", caa.issues, caa.warnings, providerSpec.caaRequired),
    section(
      "DNSSEC",
      `${dnssec.dsCount} DS record(s)`,
      dnssec.issues,
      dnssec.warnings,
      providerSpec.dnssecRequired,
    ),
    section("security.txt", SECURITY_TXT_URL, securityTxt.issues, securityTxt.warnings, providerSpec.securityTxtRequired),
  ];

  const requiredPass = sections.filter((s) => s.required).every((s) => s.ok);
  const report = {
    domain: args.domain,
    provider: providerSpec.label,
    expectMail: args.expectMail,
    mailContactsVerifiedInRepo: TARGET.verified === true,
    dkimDeferred: dkim.deferred === true,
    sections,
    pass: requiredPass,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nDomain email/DNS verification — ${args.domain}`);
    console.log(`Provider profile: ${providerSpec.label}`);
    console.log(`Mail contacts verified in repo: ${TARGET.verified === true ? "yes" : "no"}\n`);
    for (const s of sections) {
      const tag = s.ok ? "PASS" : s.required ? "FAIL" : "WARN";
      console.log(`${tag}  ${s.name}${s.required ? "" : " (optional)"}`);
      console.log(`      ${s.detail}`);
      for (const issue of s.issues) console.log(`      - ${issue}`);
      for (const warn of s.warnings ?? []) console.log(`      ~ ${warn}`);
    }
    console.log(`\nAGGREGATE  ${report.pass ? "PASS" : "FAIL"} (required checks only)`);
  }

  const strictFail = !report.pass || (args.expectMail && !TARGET.verified);
  if (args.expectMail && !TARGET.verified && !args.json) {
    console.log("\nNote: --expect-mail also requires config/mail-contacts.json verified=true and inbound forward tests.");
  }
  process.exit(strictFail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
