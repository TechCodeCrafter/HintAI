#!/usr/bin/env node
/**
 * After DNS + mailbox delivery are verified, publish mailto contacts to security.txt
 * and set config/mail-contacts.json verified=true.
 *
 *   node scripts/verify-domain-email.mjs --expect-mail   # must pass first (manual mailbox tests too)
 *   node scripts/publish-mail-contacts.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(ROOT, "config/mail-contacts.json");
const SECURITY_TXT_PATH = join(ROOT, "public/.well-known/security.txt");

function main() {
  const profile = JSON.parse(readFileSync(CONFIG_PATH, "utf8")).launchProfile ?? "launch";
  const verify = spawnSync(process.execPath, ["scripts/verify-domain-email.mjs", "--provider", profile], {
    cwd: ROOT,
    encoding: "utf8",
  });
  process.stdout.write(verify.stdout ?? "");
  process.stderr.write(verify.stderr ?? "");
  if (verify.status !== 0) {
    console.error("\n[publish-mail-contacts] DNS verification failed — fix DNS before publishing mailto contacts.");
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  config.verified = true;
  if (!config.mailProvider) config.mailProvider = "Namecheap Email Forwarding";
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);

  const securityTxt = `Contact: mailto:${config.securityEmail}
Contact: mailto:${config.abuseEmail}
Contact: ${config.githubSecurityAdvisory}
Preferred-Languages: en
Canonical: https://www.meethint.ai/.well-known/security.txt
Expires: 2027-09-14T00:00:00.000Z
Policy: https://www.meethint.ai/security
`;
  writeFileSync(SECURITY_TXT_PATH, securityTxt);

  console.log("\n[publish-mail-contacts] Updated config/mail-contacts.json (verified=true) and public/.well-known/security.txt");
  console.log("[publish-mail-contacts] Rebuild/redeploy required. Update trust page tests if mailto is now public.");
}

main();
