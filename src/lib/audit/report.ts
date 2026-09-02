import { citationText } from "../search/cite.ts";
import type { Evidence } from "../search/evidence.ts";
import type { Claim, ClaimStatus, MeetingRecord } from "./types.ts";

function heading(status: ClaimStatus): string {
  return status === "supported" ? "Supported by the pack" : "Unverified";
}

function evidenceLine(evidence: Evidence): string {
  if (evidence.kind === "text") return `${evidence.path}:${evidence.startLine} — ${evidence.text.trim()}`;
  if (evidence.kind === "document") {
    return `${evidence.path} · page ${evidence.page} — ${evidence.spokenText.trim()}`;
  }
  return `Commit ${evidence.shortSha} — ${evidence.message.trim()}`;
}

function claimBlock(claim: Claim): string {
  const lines = [`- **${claim.speaker}:** ${claim.text}`];
  if (claim.evidence && claim.evidence.length > 0) {
    for (const item of claim.evidence.slice(0, 1)) {
      lines.push(`  - Evidence: ${evidenceLine(item)}`);
    }
  }
  return lines.join("\n");
}

/** Markdown Claim Audit Report. Host-only; not spoken in the room. */
export function claimAuditReport(meeting: MeetingRecord, _history: MeetingRecord[] = []): string {
  const ended = meeting.endedAt ? new Date(meeting.endedAt).toISOString() : "in progress";
  const sections: string[] = [
    `# Claim Audit Report`,
    ``,
    `**Meeting:** ${meeting.name}`,
    `**Started:** ${new Date(meeting.startedAt).toISOString()}`,
    `**Ended:** ${ended}`,
    `**Claims:** ${meeting.claims.length}`,
    ``,
    `## All claims`,
    ``,
  ];

  if (meeting.claims.length === 0) {
    sections.push("_No factual claims were recorded._", ``);
  } else {
    for (const claim of meeting.claims) {
      sections.push(`- (${claim.status}) **${claim.speaker}:** ${claim.text}`);
    }
    sections.push(``);
  }

  for (const status of ["supported", "unverified"] as const) {
    const group = meeting.claims.filter((claim) => claim.status === status);
    sections.push(`## ${heading(status)}`, ``);
    if (group.length === 0) {
      sections.push("_None._", ``);
      continue;
    }
    for (const claim of group) sections.push(claimBlock(claim), ``);
  }

  return sections.join("\n");
}

export function reportFilename(meeting: MeetingRecord): string {
  const stamp = new Date(meeting.startedAt).toISOString().slice(0, 10);
  const slug = meeting.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `claim-audit-${slug || "meeting"}-${stamp}.md`;
}

export function downloadClaimReport(markdown: string, filename: string): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function evidenceCitation(evidence: Evidence): string {
  if (evidence.kind === "text") {
    return citationText({
      kind: "file",
      path: evidence.path,
      line: evidence.startLine,
      endLine: evidence.endLine,
      label: evidence.path,
    });
  }
  if (evidence.kind === "document") {
    return citationText({
      kind: "document",
      sourceId: evidence.sourceId,
      path: evidence.path,
      page: evidence.page,
      heading: evidence.heading,
      label: evidence.path,
    });
  }
  return citationText({
    kind: "commit",
    sha: evidence.sha,
    shortSha: evidence.shortSha,
    pr: evidence.pr,
    author: evidence.author,
    date: evidence.date,
    label: evidence.shortSha,
  });
}
