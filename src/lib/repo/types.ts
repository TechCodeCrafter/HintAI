export type RepoFile = {
  path: string;
  language: string;
  content: string;
};

export type RepoCommit = {
  sha: string;
  date: string;
  author: string;
  message: string;
  files: string[];
  pr?: string;
};

export type RepoPack = {
  id: string;
  name: string;
  description: string;
  files: RepoFile[];
  commits: RepoCommit[];
};

export type Chunk = {
  id: string;
  kind: "code" | "why";
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  sha?: string;
  author?: string;
  date?: string;
  pr?: string;
  message?: string;
};

export type Hit = Chunk & { score: number };

export type Citation = {
  path: string;
  line: number;
  sha?: string;
  pr?: string;
  label: string;
};

export type Card = {
  say: string | null;
  reason?: string;
  citations: Citation[];
  query: string;
  latencyMs: number;
  source: "grok" | "local";
};

export type Utterance = {
  id: string;
  at: number;
  speaker: string;
  role: "them" | "you" | "system";
  text: string;
};

/**
 * One commit from a listening lane.
 *
 * `id` is the identity of the audio event, minted where the clip is committed —
 * never derived from the text. Two people asking byte-identical questions are
 * two events and must both reach the question gate; one clip re-transcribed by a
 * longer pass is one event, and rewrites the line it already owns.
 */
export type HeardEvent = {
  id: string;
  role: "them" | "you";
  text: string;
};
