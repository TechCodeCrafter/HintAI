/**
 * Markdown section answers: README and docs as evidence.
 *
 * Product questions in a meeting ("how do I self-host it?", "does the server
 * see my key?", "what license is it?") are usually answered by a README, and
 * READMEs are written as headings, bullets, tables and command blocks, not as
 * the docstring prose `proseOf` reads. This module reads those shapes.
 *
 * Like the rest of the local path it is extractive. Every word spoken is
 * copied from the cited lines, except a short fixed list of joining words
 * (`STRUCTURAL`) that the support check is told about. The heading is used to
 * decide which section answers the question and may label a very short answer
 * ("License: MIT."), and the heading line is then part of the cited span.
 */
import type { FileHit } from "../repo/types.ts";
import { covers } from "./code-locator.ts";
import { type TextEvidence, textEvidence } from "./evidence.ts";
import { plain } from "./prose.ts";

const MARKDOWN = /\.(md|mdx|markdown)$/i;

/** "Related packages", "See also", "Credits": sections about other projects. */
const ASIDE = /^(?:related|see also|alternatives|similar|credits|acknowledg|sponsors|backers|badges|links|changelog|history)\b/i;

/** Joining words the templates add. Every other word comes from the file. */
export const STRUCTURAL = ["and", "run", "or"];

type UnitKind = "sentence" | "bullet" | "row" | "code";

type Unit = {
  kind: UnitKind;
  /** Spoken form. */
  text: string;
  start: number;
  end: number;
  /** Lead-in that ends with ":" and introduces the block right after it. */
  lead: boolean;
  /** Index of the first cell for table rows, to match "Search | ..." rows. */
  label?: string;
};

type Section = {
  heading: string;
  headingStart: number;
  headingEnd: number;
  units: Unit[];
};

/** Small synonym table: question words that READMEs phrase differently. */
const SYNONYMS: Record<string, string[]> = {
  duplicate: ["merged", "twice", "dedupe", "re-asked"],
  duplicates: ["merged", "twice", "dedupe", "re-asked"],
  formats: ["pdf", "docx", "zip", "xlsx", "pptx"],
  format: ["pdf", "docx", "zip", "xlsx", "pptx"],
  fast: ["ms", "takes", "seconds"],
  speed: ["ms", "takes", "seconds"],
  install: ["npm", "clone", "setup"],
  setup: ["install", "npm", "clone"],
  deploy: ["vercel", "deploy", "host"],
  tests: ["test"],
};

function expand(terms: string[]): string[][] {
  return terms.map((term) => [term, ...(SYNONYMS[term] ?? [])]);
}

/** Query terms (with synonyms) that a text covers. */
function coverage(text: string, groups: string[][]): number {
  return groups.filter((group) => group.some((word) => covers(text, [word]) > 0 || text.toLowerCase().includes(` ${word} `))).length;
}

function sentencesOf(text: string, start: number): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  // Split on sentence ends that are followed by whitespace, keeping decimals.
  let from = 0;
  const ends = [...text.matchAll(/[.!?]+(?=\s+[A-Z(`"*]|\s*$)/g)];
  for (const m of ends) {
    const to = (m.index ?? 0) + m[0].length;
    const raw = text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    if (raw.trim()) out.push({ text: raw.trim(), start: start + from + lead, end: start + to });
    from = to;
  }
  const rest = text.slice(from);
  if (rest.trim()) {
    const lead = rest.length - rest.trimStart().length;
    out.push({ text: rest.trim(), start: start + from + lead, end: start + text.trimEnd().length });
  }
  return out;
}

/** Parse markdown into sections of speakable units with exact offsets. */
export function parseSections(content: string): Section[] {
  const sections: Section[] = [{ heading: "", headingStart: 0, headingEnd: 0, units: [] }];
  const lines = content.split("\n");
  let offset = 0;
  let fence = false;
  let para: { text: string; start: number; end: number } | null = null;
  const current = () => sections[sections.length - 1]!;
  const flush = () => {
    if (!para) return;
    for (const s of sentencesOf(para.text, para.start)) {
      const spoken = plain(s.text);
      if (spoken) current().units.push({ kind: "sentence", text: spoken, start: s.start, end: s.end, lead: /:$/.test(spoken) });
    }
    para = null;
  };
  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      flush();
      fence = !fence;
      continue;
    }
    if (fence) {
      // "$ npm install cors": the prompt is not part of the command.
      const command = trimmed.replace(/\s+#\s.*$/, "").replace(/^\$\s+/, "").trim();
      if (!command || command.startsWith("#")) continue;
      const at = lineStart + line.indexOf(command);
      current().units.push({ kind: "code", text: command, start: at, end: at + command.length, lead: false });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    // Badges, link reference definitions and callout markers are not prose.
    if (/^(?:\[?!\[[^\]]*\](?:\[[^\]]*\]|\([^)]*\))\]?(?:\[[^\]]*\]|\([^)]*\))?\s*)+$/.test(trimmed) || /^\[[^\]]+\]:\s*\S+$/.test(trimmed)) {
      flush();
      continue;
    }
    if (/^>\s*\[!\w+\]\s*$/.test(trimmed)) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(trimmed);
    if (heading) {
      flush();
      sections.push({ heading: plain(heading[2]!), headingStart: lineStart, headingEnd: lineEnd, units: [] });
      continue;
    }
    if (/^\|/.test(trimmed)) {
      flush();
      if (/^\|[\s:|-]+\|?$/.test(trimmed)) continue;
      const cells = trimmed.replace(/^\||\|$/g, "").split("|").map((cell) => plain(cell.trim()));
      if (cells.length < 2 || cells.every((cell) => !cell)) continue;
      const body = cells[cells.length - 1]!;
      const clause = body.split(/,\s+|;\s+|\s+—\s+/)[0]!.replace(/[.]$/, "");
      const text = `${cells[0]}: ${clause}.`;
      const at = lineStart + line.indexOf(trimmed);
      current().units.push({ kind: "row", text, start: at, end: at + trimmed.length, lead: false, label: cells[0]!.toLowerCase() });
      continue;
    }
    const bullet = /^([-*+]|\d+[.)])\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flush();
      // A table-of-contents entry ("* [Installation](#installation)") is a link, not a fact.
      if (/^\[[^\]]+\]\(#[^)]*\)$/.test(bullet[2]!.trim())) continue;
      const bodyAt = lineStart + line.indexOf(bullet[2]!);
      // A bolded label ("**Sources:** upload ...") is kept: it names the topic.
      // "* `maxAge`: Configures ..." and "- **Sources:** ..." name their topic
      // before the colon, like the first cell of a table row.
      const labelled = /^(?:\*\*|`)([^*`]{1,40})(?:\*\*|`):?\s*(?:\*\*)?:?\s+\S/.exec(bullet[2]!.trim());
      let first = true;
      for (const s of sentencesOf(bullet[2]!, bodyAt)) {
        const spoken = plain(s.text);
        if (!spoken) continue;
        const label = first && labelled ? labelled[1]!.replace(/:$/, "").toLowerCase() : undefined;
        current().units.push({ kind: "bullet", text: spoken, start: s.start, end: s.end, lead: /:$/.test(spoken), ...(label ? { label } : {}) });
        first = false;
      }
      continue;
    }
    if (para) {
      para.text += `\n${line}`;
      para.end = lineEnd;
    } else {
      para = { text: line, start: lineStart, end: lineEnd };
    }
  }
  flush();
  return sections.filter((section) => section.units.length > 0);
}

export type SectionAnswer = {
  say: string;
  spans: TextEvidence[];
  hit: FileHit;
  /** Query terms covered by the spoken text plus its heading. */
  coverage: number;
  /** The section heading matched the question. */
  headingMatch: boolean;
  structural: string[];
  /** Verbatim pieces a lead-in answer was joined from, when it was. */
  parts?: string[];
};

const ENV_LINE = /^([A-Z][A-Z0-9_]{2,})=/;

/** "a, b and c" over copied items. */
function joinItems(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function endSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * The best markdown answer among the markdown files in the hits, or null.
 *
 * Admission: at least one query term in the spoken text itself, and the
 * spoken text plus its heading covers at least half the question's terms.
 */
export function sectionAnswer(
  canonical: string,
  terms: string[],
  hits: FileHit[],
  fileContent: (path: string) => string | undefined,
  opts: { requireAll?: boolean } = {},
): SectionAnswer | null {
  if (terms.length === 0) return null;
  const groups = expand(terms);
  const howTo = /^\s*how (?:do|can|should|would) (?:i|we|you)\b|^\s*how to\b/i.test(canonical);
  const seen = new Set<string>();
  let best: (SectionAnswer & { score: number }) | null = null;

  for (const hit of hits) {
    if (!MARKDOWN.test(hit.path) || seen.has(hit.path)) continue;
    seen.add(hit.path);
    const content = fileContent(hit.path);
    if (!content) continue;
    const sections = parseSections(content);
    for (const section of sections) {
      // Sections about other things never answer for this one.
      if (ASIDE.test(section.heading)) continue;
      const headingCover = section.heading ? coverage(section.heading, groups) : 0;
      section.units.forEach((unit, index) => {
        if (unit.kind === "code" && !(headingCover > 0 && index === 0)) return;
        const blockText = unit.lead
          ? section.units.slice(index - 1, index + 8).filter((u) => u.kind === "code" || u === section.units[index - 1]).map((u) => u.text).join(" ")
          : "";
        // A block of NAME=value lines is, literally, environment variables.
        const envBlock = unit.lead && section.units[index + 1]?.kind === "code" && ENV_LINE.test(section.units[index + 1]!.text)
          ? " environment variables env vars "
          : "";
        const own = coverage(`${unit.text} ${blockText}${envBlock}`, groups);
        const labelHit = unit.label ? coverage(unit.label, groups) : 0;
        if (own === 0 && !(headingCover > 0 && index === 0)) return;
        const total = coverage(`${section.heading} ${unit.text} ${blockText}${envBlock}`, groups);
        if (total * 2 < terms.length) return;
        // A yes/no question is only answered by a line that names all of it.
        if (opts.requireAll && (unit.kind === "code" || unit.kind === "row" || own < terms.length)) return;

        // Compose: a lead-in ending in ":" takes the block that follows it.
        const used: Unit[] = [unit];
        let say: string;
        // A lead-in joined to its block is stitched from verbatim pieces; each
        // piece is checked against the file on its own (see docSectionCard).
        let parts: string[] | undefined;
        let commands = false;
        if (unit.kind === "code" || (unit.lead && section.units[index + 1]?.kind === "code")) {
          const block: Unit[] = [];
          for (let i = unit.kind === "code" ? index : index + 1; i < section.units.length; i += 1) {
            const next = section.units[i]!;
            if (next.kind !== "code") break;
            block.push(next);
          }
          if (block.length === 0) return;
          const env = block.map((u) => ENV_LINE.exec(u.text)?.[1]).filter((v): v is string => Boolean(v));
          const items = env.length === block.length ? env : block.map((u) => u.text);
          if (items.join(", ").length > 200) return;
          if (unit.kind !== "code") {
            say = `${unit.text.replace(/:$/, "")}: ${joinItems(items)}.`;
            used.push(...block);
            parts = [unit.text.replace(/:$/, ""), ...items];
            commands = env.length === 0;
            // "They're read only on the server: ..." needs the sentence that
            // says what "they" are.
            const prev = section.units[index - 1];
            if (/^(?:they|these|it|this|those)\b/i.test(unit.text) && prev && prev.kind === unit.kind && unit.start - prev.end <= 2) {
              say = `${endSentence(prev.text)} ${say}`;
              used.unshift(prev);
              parts.unshift(prev.text);
            }
          } else {
            say = howTo ? `Run ${joinItems(items)}.` : `${section.heading}: ${joinItems(items)}.`;
            used.splice(0, 1, ...block);
          }
        } else if (unit.lead) {
          return;
        } else if (howTo && headingCover > 0 && section.units[index + 1]?.kind === "code" && unit.kind === "sentence") {
          // "You can install this package with npm, yarn ... or bun." then
          // a block of commands: the sentence, then the first command.
          const command = section.units[index + 1]!;
          say = `${endSentence(unit.text)} Run ${command.text}.`;
          used.push(command);
          parts = [unit.text.replace(/[.!?]$/, ""), command.text];
          commands = true;
        } else if (unit.text.split(/\s+/).length <= 5 && section.heading && headingCover > 0) {
          // "License: MIT." — the heading carries the subject; "What it does:" would not.
          say = `${section.heading}: ${endSentence(unit.text)}`;
          // The heading and the line are separate blocks of the file.
          parts = [section.heading, unit.text.replace(/[.!?]$/, "")];
        } else {
          say = endSentence(unit.text);
          // A short follow-up sentence in the same bullet or paragraph often
          // carries the point ("This site's server never receives the key").
          const next = section.units[index + 1];
          if (next && next.kind === unit.kind && next.start - unit.end <= 2 && !next.lead) {
            const pair = `${say} ${endSentence(next.text)}`;
            if (pair.length <= 260 && coverage(next.text, groups) > 0) {
              say = pair;
              used.push(next);
            }
          }
        }
        if (say.length > 280) return;

        const spoken = coverage(`${section.heading} ${say}${envBlock}`, groups);
        // The heading earns credit only for terms the line itself does not
        // already name; "## Your key" adds nothing to a line about keys.
        const body = section.heading && say.startsWith(`${section.heading}:`) ? say.slice(section.heading.length + 1) : say;
        const headingAdds = section.heading ? spoken - coverage(`${body}${envBlock}`, groups) : 0;
        let score = spoken + headingAdds * 1.5 + labelHit * 1.5 + (index === 0 ? 0.25 : 0);
        // A how-to is answered by the commands: "Run X." or a lead-in with its block.
        if (howTo && (say.startsWith("Run ") || commands)) score += 0.5;
        // Between equal answers, the shorter one is the better spoken line.
        score -= say.length / 10_000;
        if (!best || score > best.score) {
          const path = hit.path;
          const sourceId = hit.sourceId;
          const spanOf = (start: number, end: number) =>
            textEvidence({ path, content, start, end, normalizedText: content.slice(start, end).replace(/\s+/g, " ").trim(), sourceId });
          const spans: TextEvidence[] = [];
          const usesHeading = say.startsWith(`${section.heading}:`) && Boolean(section.heading);
          if (usesHeading) {
            const h = spanOf(section.headingStart, section.headingEnd);
            if (h) spans.push(h);
          }
          for (const u of used) {
            const s = spanOf(u.start, u.end);
            if (s) spans.push(s);
          }
          if (spans.length === 0) return;
          best = {
            say,
            spans: usesHeading && spans.length > 1 ? [spans[1]!, spans[0]!, ...spans.slice(2)] : spans,
            hit,
            coverage: spoken,
            headingMatch: headingCover > 0,
            structural: STRUCTURAL,
            ...(parts ? { parts } : {}),
            score,
          };
        }
      });
    }
  }
  // `best` is assigned inside the forEach closure, which narrowing cannot see.
  const found = best as (SectionAnswer & { score: number }) | null;
  if (!found) return null;
  const { score: _score, ...answer } = found;
  return answer;
}
