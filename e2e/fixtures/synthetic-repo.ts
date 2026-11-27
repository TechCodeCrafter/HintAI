import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A folder shaped like an engineering repository, written to disk.
 *
 * The same seed writes the same files, so a measurement can be run again.
 * Sizes follow a real codebase (this one averages about 5 KB a source file,
 * with a long tail), and the words follow code: a few are everywhere and most
 * are rare. One file in every `FACT_EVERY` carries a sentence found nowhere
 * else, so a question has one right file to come back with.
 */
export type SyntheticRepo = {
  /** The folder to select. Its name is the repo's name. */
  folder: string;
  name: string;
  /** Files written that the app should index. */
  files: number;
  bytes: number;
  /** A question for each planted sentence, with the file that holds it. */
  facts: Array<{ question: string; path: string; answer: string }>;
  /** Files written that the app must leave out, each with the reason it should give. */
  skipped: Array<{ path: string; reason: string }>;
  remove: () => void;
};

export type SyntheticRepoOptions = {
  files: number;
  seed?: number;
  /** Mean size of a source file in bytes. */
  meanBytes?: number;
  /**
   * Also write files the app must skip: an image, an empty file, a file over
   * the per-file size limit, a lockfile and a vendor folder.
   */
  withSkipped?: boolean;
};

const FACT_EVERY = 50;

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const SYLLABLES =
  "ac ad al an ar ba bi bo ca ce co da de di do el en er fa fi fo ga ge go ha he hi in is ka ke la le li lo ma me mi mo na ne no or pa pe po ra re ri ro sa se si so ta te ti to ur va ve vi vo wa we za ze".split(
    " ",
  );
const DOMAIN =
  "account address adapter audit balance batch billing bucket cache campaign carrier cart catalog charge checkout client cluster cohort config connector consumer contract coupon cursor customer dashboard dataset delivery deploy digest dispatch document driver endpoint entity event exporter feature feed filter fixture gateway handler header health import index ingest inventory invoice job journal ledger limit listener locale lock logger manifest mapper merchant message metric migration monitor notification order outbox parser partition payload payment payout pipeline plan policy price producer profile project provider publisher queue quota rate receipt record refund region registry release replica report request resolver response retry route rule runner sandbox schedule schema scope segment sensor service session settlement shard shipment signal snapshot source stream subscriber subscription summary tariff task template tenant ticket timeline token topic tracker transaction transfer trigger upload usage validator version view voucher wallet warehouse webhook widget worker workflow workspace".split(
    " ",
  );
const VERBS =
  "apply assign build cancel check close collect commit compute create decode delete dispatch drain emit encode enqueue expire fetch filter flush format handle hydrate insert load lock merge normalize notify open parse persist publish read reconcile refresh register reject release render replay resolve retry revoke rotate route sample schedule send serialize settle split start stop store submit sync throttle track transform update upsert validate verify write".split(
    " ",
  );
const TEAMS = ["payments", "platform", "growth", "data", "identity", "logistics", "search", "billing"];

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

type Words = {
  random: () => number;
  /** A made-up identifier word. A few are common, most are rare. */
  rare: () => string;
  domain: () => string;
  verb: () => string;
  int: (max: number) => number;
};

function words(seed: number): Words {
  const random = rng(seed);
  const made = new Set<string>();
  while (made.size < 6000) {
    const parts = 2 + Math.floor(random() * 3);
    let word = "";
    for (let i = 0; i < parts; i += 1) word += SYLLABLES[Math.floor(random() * SYLLABLES.length)];
    made.add(word);
  }
  const vocab = [...made];
  return {
    random,
    rare: () => vocab[Math.floor(vocab.length * random() ** 3)],
    domain: () => DOMAIN[Math.floor(DOMAIN.length * random() ** 1.5)],
    verb: () => VERBS[Math.floor(VERBS.length * random())],
    int: (max) => Math.floor(random() * max),
  };
}

/** How many declarations a file gets. Most are small; a few are several times the mean. */
function unitsFor(w: Words, meanBytes: number, unitBytes: number): number {
  const spread = Math.exp((w.random() + w.random() + w.random() - 1.5) * 1.1);
  return Math.max(1, Math.min(60, Math.round((meanBytes * spread) / unitBytes)));
}

function tsFile(w: Words, meanBytes: number, fact: string | null): string {
  const out: string[] = [];
  const imports = 1 + w.int(4);
  for (let i = 0; i < imports; i += 1) {
    const name = w.domain();
    out.push(`import { ${name}${cap(w.verb())}, type ${cap(name)}Options } from "../${w.domain()}/${name}";`);
  }
  out.push("");
  if (fact) out.push("/**", ` * ${fact}`, " */", `export const ${w.rare().toUpperCase()}_NOTE = true;`, "");
  const units = unitsFor(w, meanBytes, 620);
  for (let u = 0; u < units; u += 1) {
    const subject = w.domain();
    const verb = w.verb();
    const other = w.domain();
    const local = w.rare();
    const fn = `${verb}${cap(subject)}${cap(w.rare())}`;
    out.push(
      "/**",
      ` * ${cap(verb)}s the ${subject} for one ${other}, then hands the ${local} to the ${w.domain()} ${w.verb()} step.`,
      ` * A ${subject} that is older than ${1 + w.int(90)} minutes is skipped and counted in the ${w.domain()} metric.`,
      " */",
      `export async function ${fn}(input: ${cap(subject)}Input, options: ${cap(other)}Options = {}): Promise<${cap(subject)}Result> {`,
      `  const ${local} = await ${other}${cap(w.verb())}(input.${other}Id, options);`,
      `  if (!${local}) throw new Error("missing ${other} for ${subject} " + input.id);`,
      `  const ${w.rare()} = ${local}.items.filter((item) => item.${w.domain()} > ${w.int(500)});`,
      `  for (const item of ${local}.items) {`,
      `    await item.${w.verb()}({ ${subject}: input.${subject}, mode: "${w.domain()}-${w.rare()}" });`,
      "  }",
      `  return { id: input.id, ${subject}: ${local}.${w.domain()}, count: ${local}.items.length };`,
      "}",
      "",
    );
  }
  return out.join("\n");
}

function pyFile(w: Words, meanBytes: number, fact: string | null): string {
  const out: string[] = [`"""${cap(w.domain())} ${w.domain()} helpers."""`, "", "from dataclasses import dataclass", ""];
  if (fact) out.push(`# ${fact}`, "");
  const units = unitsFor(w, meanBytes, 480);
  for (let u = 0; u < units; u += 1) {
    const subject = w.domain();
    const verb = w.verb();
    const local = w.rare();
    out.push(
      `def ${verb}_${subject}_${w.rare()}(${local}, limit=${1 + w.int(200)}):`,
      `    """${cap(verb)} the ${subject} for a ${w.domain()} and return the ${w.domain()} rows.`,
      "",
      `    Rows past the limit go to the ${w.domain()} ${w.domain()} for the next run.`,
      '    """',
      `    rows = [row for row in ${local}.${w.domain()}s if row.${w.domain()} > ${w.int(100)}]`,
      "    if not rows:",
      `        raise ValueError("no ${subject} rows for %s" % ${local}.id)`,
      `    return rows[:limit]`,
      "",
      "",
    );
  }
  return out.join("\n");
}

function goFile(w: Words, meanBytes: number, fact: string | null): string {
  const out: string[] = [`package ${w.domain()}`, "", 'import "context"', ""];
  if (fact) out.push(`// ${fact}`, "");
  const units = unitsFor(w, meanBytes, 520);
  for (let u = 0; u < units; u += 1) {
    const subject = w.domain();
    const verb = cap(w.verb());
    const local = w.rare();
    out.push(
      `// ${verb}${cap(subject)} ${w.verb()}s the ${subject} and reports to the ${w.domain()} ${w.domain()}.`,
      `func ${verb}${cap(subject)}${cap(w.rare())}(ctx context.Context, ${local} *${cap(subject)}) (int, error) {`,
      `\tif ${local} == nil {`,
      `\t\treturn 0, Err${cap(subject)}Missing`,
      "\t}",
      `\tcount := 0`,
      `\tfor _, item := range ${local}.${cap(w.domain())}s {`,
      `\t\tif item.${cap(w.domain())} > ${w.int(300)} {`,
      "\t\t\tcount++",
      "\t\t}",
      "\t}",
      "\treturn count, nil",
      "}",
      "",
    );
  }
  return out.join("\n");
}

function mdFile(w: Words, meanBytes: number, fact: string | null): string {
  const out: string[] = [`# ${cap(w.domain())} ${w.domain()} guide`, ""];
  if (fact) out.push(fact, "");
  const units = unitsFor(w, meanBytes, 430);
  for (let u = 0; u < units; u += 1) {
    const a = w.domain();
    const b = w.domain();
    out.push(
      `## ${cap(a)} and ${b} (${w.rare()})`,
      "",
      `The ${a} service owns the ${b} table. Writes to the ${b} go through the ${w.domain()} queue, and a ${a} that falls`,
      `behind by ${2 + w.int(40)} minutes raises the ${w.rare()} alert. The ${TEAMS[w.int(TEAMS.length)]} team reviews the`,
      `${w.domain()} dashboard every ${1 + w.int(9)} days and files a ${w.domain()} ${w.domain()} when the ${w.rare()} count grows.`,
      "",
    );
  }
  return out.join("\n");
}

function yamlFile(w: Words): string {
  const out: string[] = [`service: ${w.domain()}-${w.rare()}`, "settings:"];
  const rows = 6 + w.int(30);
  for (let i = 0; i < rows; i += 1) out.push(`  ${w.domain()}_${w.rare()}: ${w.int(900)}`);
  return `${out.join("\n")}\n`;
}

function sqlFile(w: Words, fact: string | null): string {
  const table = `${w.domain()}_${w.domain()}s`;
  const out: string[] = fact ? [`-- ${fact}`] : [];
  out.push(`CREATE TABLE ${table} (`, "  id BIGINT PRIMARY KEY,");
  const cols = 4 + w.int(14);
  for (let i = 0; i < cols; i += 1) out.push(`  ${w.domain()}_${w.rare()} ${i % 3 === 0 ? "TEXT" : "INTEGER"} NOT NULL,`);
  out.push("  created_at TIMESTAMP NOT NULL", ");", "", `CREATE INDEX ${table}_${w.rare()}_idx ON ${table} (created_at);`, "");
  return out.join("\n");
}

/** Writes the repo under the system temp folder and returns what it wrote. */
export function writeSyntheticRepo(options: SyntheticRepoOptions): SyntheticRepo {
  const seed = options.seed ?? 7;
  const meanBytes = options.meanBytes ?? 5200;
  const w = words(seed);
  const name = `acme-${options.files}`;
  const root = join(tmpdir(), `hint-synth-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const folder = join(root, name);
  const facts: SyntheticRepo["facts"] = [];
  const skipped: SyntheticRepo["skipped"] = [];
  let bytes = 0;
  const write = (path: string, content: string | Buffer) => {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };

  for (let i = 0; i < options.files; i += 1) {
    const roll = w.random();
    const area = `${w.domain()}/${w.domain()}`;
    const base = `${w.domain()}-${w.rare()}-${i}`;
    let fact: string | null = null;
    let answer = "";
    let question = "";
    if (i % FACT_EVERY === 0) {
      // Two made-up words together appear in no other file.
      const a = w.rare();
      const b = `${w.rare()}${i}`;
      const times = 2 + w.int(7);
      const team = TEAMS[w.int(TEAMS.length)];
      fact = `The ${a} ${b} job retries ${times} times before it pages the ${team} team.`;
      question = `How many times does the ${a} ${b} job retry before it pages someone?`;
      answer = String(times);
    }
    let path: string;
    let content: string;
    if (roll < 0.58) {
      path = `src/${area}/${base}.ts`;
      content = tsFile(w, meanBytes, fact);
    } else if (roll < 0.7) {
      path = `services/${area}/${base}.py`;
      content = pyFile(w, meanBytes, fact);
    } else if (roll < 0.79) {
      path = `internal/${area}/${base}.go`;
      content = goFile(w, meanBytes, fact);
    } else if (roll < 0.91) {
      path = `docs/${area}/${base}.md`;
      content = mdFile(w, meanBytes, fact);
    } else if (roll < 0.95 && !fact) {
      path = `config/${area}/${base}.yaml`;
      content = yamlFile(w);
    } else {
      path = `db/${area}/${base}.sql`;
      content = sqlFile(w, fact);
    }
    write(path, content);
    bytes += Buffer.byteLength(content);
    if (fact) facts.push({ question, path, answer });
  }

  if (options.withSkipped) {
    write("assets/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
    skipped.push({ path: "assets/logo.png", reason: "binaries and media" });
    write("docs/empty.md", "");
    skipped.push({ path: "docs/empty.md", reason: "files with no text" });
    write("src/generated-table.ts", `export const TABLE = [\n${"  0x0f0f0f0f,\n".repeat(13_000)}];\n`);
    skipped.push({ path: "src/generated-table.ts", reason: "files over the size limit" });
    write("yarn.lock", "# yarn lockfile v1\n");
    skipped.push({ path: "yarn.lock", reason: "lockfiles" });
    for (let i = 0; i < 12; i += 1) write(`node_modules/pkg-${i}/index.js`, `module.exports = ${i};\n`);
    skipped.push({ path: "node_modules/", reason: "vendor and build folders" });
  }

  return {
    folder,
    name,
    files: options.files,
    bytes,
    facts,
    skipped,
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
