import { getContextRepository } from "../../context/service.ts";
import { isPdfSource } from "../../context/types.ts";
import { documentEvidenceFromRange } from "../evidence.ts";
import { buildPdfBytes } from "../pdf/build-fixture.ts";
import { EVAL_PDF_FIXTURES } from "../pdf/eval-fixtures.ts";
import { parseAndPersistPdf } from "../pdf/ingest.ts";
import type { NormalizedDocument } from "../types.ts";
import type { DocumentEvidence } from "../../search/evidence.ts";
import type { HighlightMode } from "./types.ts";
import { openTargetFromEvidence } from "./resolve.ts";
import { syncViewerBlobPins } from "./retain.ts";
import { useMeetHint } from "../../store.ts";

export const HYPHEN_PDF = buildPdfBytes({
  pages: [
    {
      items: [
        { str: "serial-", x: 72, y: 700 },
        { str: "izable", x: 72, y: 684 },
      ],
    },
  ],
});

export type ViewerShot = {
  id: string;
  path: string;
  bytes: Uint8Array;
  needle: string;
  forceMode?: HighlightMode;
  stale?: boolean;
};

export const VIEWER_SHOTS: ViewerShot[] = [
  { id: "exact", path: "lecture.pdf", bytes: EVAL_PDF_FIXTURES["lecture.pdf"], needle: "prevents lost outcomes" },
  {
    id: "multi",
    path: "lecture.pdf",
    bytes: EVAL_PDF_FIXTURES["lecture.pdf"],
    needle: "Serializable isolation prevents lost outcomes",
  },
  { id: "hyphen", path: "hyphen.pdf", bytes: HYPHEN_PDF, needle: "serializable" },
  { id: "twocol-left", path: "paper.pdf", bytes: EVAL_PDF_FIXTURES["paper.pdf"], needle: "Two-phase locking requires waits" },
  {
    id: "twocol-right",
    path: "paper.pdf",
    bytes: EVAL_PDF_FIXTURES["paper.pdf"],
    needle: "Snapshot isolation allows write skew",
  },
  {
    id: "item-box",
    path: "lecture.pdf",
    bytes: EVAL_PDF_FIXTURES["lecture.pdf"],
    needle: "prevents lost outcomes",
    forceMode: "item-box",
  },
  {
    id: "caption",
    path: "lecture.pdf",
    bytes: EVAL_PDF_FIXTURES["lecture.pdf"],
    needle: "prevents lost outcomes",
    forceMode: "caption-only",
  },
  { id: "mobile", path: "lecture.pdf", bytes: EVAL_PDF_FIXTURES["lecture.pdf"], needle: "prevents lost outcomes" },
  {
    id: "stale",
    path: "lecture.pdf",
    bytes: EVAL_PDF_FIXTURES["lecture.pdf"],
    needle: "prevents lost outcomes",
    stale: true,
  },
];

export async function installShotDocument(shot: ViewerShot): Promise<{
  evidence: DocumentEvidence;
  document: NormalizedDocument;
}> {
  const repo = getContextRepository();
  const context = await repo.createContext({ name: `viewer-qa-${shot.id}` });
  const blob = new Blob([Uint8Array.from(shot.bytes)], { type: "application/pdf" });
  const [source] = await repo.upsertSources(context.id, [
    { path: shot.path, kind: "pdf", mimeType: "application/pdf", blob },
  ]);
  if (!source || !isPdfSource(source)) throw new Error("failed to store PDF fixture");
  await parseAndPersistPdf(repo, context.id, source);
  const document = await repo.getNormalizedDocument(source.id, source.contentHash);
  if (!document) throw new Error("normalized document missing");
  const page = document.pages.find((entry) => entry.text.includes(shot.needle)) ?? document.pages[0];
  const start = page.text.indexOf(shot.needle);
  if (start < 0) throw new Error(`needle missing in ${shot.path}: ${shot.needle}`);
  const evidence = documentEvidenceFromRange({
    document,
    page: page.pageNumber,
    normStart: start,
    normEnd: start + shot.needle.length,
    spokenText: shot.needle,
  });
  if (!evidence) throw new Error("could not build evidence");
  return { evidence, document };
}

/** Eval-only. Puts a PDF Card in the cockpit without opening the viewer. */
export async function bootCockpitViewerQa() {
  const { evidence } = await installShotDocument(VIEWER_SHOTS[0]);
  const card = {
    say: evidence.spokenText,
    citations: [
      {
        kind: "document" as const,
        sourceId: evidence.sourceId,
        path: evidence.path,
        page: evidence.page,
        evidenceId: evidence.id,
        label: "",
      },
    ],
    evidence: [evidence],
    query: VIEWER_SHOTS[0].needle,
    latencyMs: 0,
    source: "local" as const,
  };
  syncViewerBlobPins(card, null);
  useMeetHint.setState({ card, openDocument: null, contextStatus: "ready" });
  return { evidence, target: openTargetFromEvidence(evidence) };
}
