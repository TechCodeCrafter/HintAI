import type { DocumentEvidence } from "../../search/evidence.ts";
import type { NormalizedDocument } from "../types.ts";
import { viewerAvailability, STALE_SOURCE_COPY } from "./currentness.ts";
import { planHighlight, type HighlightPlanInput } from "./highlight.ts";
import type { ViewerLatency } from "./metrics.ts";
import type { DocumentOpenTarget, HighlightMode, HighlightPlan, ViewerAvailability } from "./types.ts";

export type ViewerSessionState = {
  epoch: number;
  availability: ViewerAvailability;
  message: string | null;
  page: number;
  pageCount: number;
  plan: HighlightPlan | null;
  evidenceId: string | null;
  sourceId: string | null;
  contentHash: string | null;
  latency: ViewerLatency | null;
};

export type ViewerLoaders = {
  getSourceBlob: (sourceId: string, contentHash: string) => Promise<Blob | null>;
  getNormalizedDocument: (sourceId: string, contentHash: string) => Promise<NormalizedDocument | null>;
};

const emptyLatency = (cold: boolean): ViewerLatency => ({
  blobMs: 0,
  openMs: 0,
  pageMs: 0,
  textLayerMs: 0,
  highlightMs: 0,
  totalMs: 0,
  cold,
});

export function createViewerSession(loaders: ViewerLoaders) {
  let epoch = 0;
  let disposed = false;
  let cachedKey: string | null = null;
  const state: ViewerSessionState = {
    epoch: 0,
    availability: "missing",
    message: null,
    page: 1,
    pageCount: 0,
    plan: null,
    evidenceId: null,
    sourceId: null,
    contentHash: null,
    latency: null,
  };

  function bump(): number {
    epoch += 1;
    state.epoch = epoch;
    return epoch;
  }

  function live(token: number): boolean {
    return !disposed && token === epoch;
  }

  async function prepare(
    target: DocumentOpenTarget,
    evidence: DocumentEvidence | null,
    opts?: { forceMode?: HighlightMode; page?: number; map?: HighlightPlanInput["map"]; divs?: HighlightPlanInput["divs"]; viewport?: HighlightPlanInput["viewport"] },
  ): Promise<ViewerSessionState> {
    const token = bump();
    const started = now();
    const latency = emptyLatency(cachedKey !== `${target.sourceId}:${target.contentHash}`);
    state.sourceId = target.sourceId;
    state.contentHash = target.contentHash;
    state.evidenceId = target.evidenceId ?? null;
    state.page = opts?.page ?? target.page;
    state.plan = null;
    state.message = null;

    const tBlob = now();
    const blob = await loaders.getSourceBlob(target.sourceId, target.contentHash);
    latency.blobMs = now() - tBlob;
    if (!live(token)) return state;

    const tDoc = now();
    const document = (await loaders.getNormalizedDocument(target.sourceId, target.contentHash)) ?? undefined;
    latency.openMs = now() - tDoc;
    if (!live(token)) return state;

    const availability = viewerAvailability({
      blob,
      evidence,
      document,
      requestedHash: target.contentHash,
    });
    state.availability = availability;
    state.pageCount = document?.pageCount ?? 0;

    if (availability !== "ready" || !evidence || !document) {
      state.message = STALE_SOURCE_COPY;
      state.plan = null;
      latency.totalMs = now() - started;
      state.latency = latency;
      return snapshot();
    }

    const tHighlight = now();
    const plan = planHighlight({
      evidence,
      document,
      map: opts?.map,
      divs: opts?.divs,
      viewport: opts?.viewport,
      forceMode: opts?.forceMode,
    });
    latency.highlightMs = now() - tHighlight;
    if (!live(token)) return state;

    state.plan = plan;
    state.page = opts?.page ?? evidence.page;
    cachedKey = `${target.sourceId}:${target.contentHash}`;
    latency.totalMs = now() - started;
    state.latency = latency;
    return snapshot();
  }

  function snapshot(): ViewerSessionState {
    return {
      ...state,
      latency: state.latency ? { ...state.latency } : null,
      plan: state.plan ? { ...state.plan, exact: [...state.plan.exact], boxes: [...state.plan.boxes] } : null,
    };
  }

  function discard() {
    bump();
    cachedKey = null;
    state.plan = null;
    state.availability = "missing";
    state.message = null;
    state.evidenceId = null;
    state.sourceId = null;
    state.contentHash = null;
  }

  function dispose() {
    disposed = true;
    discard();
  }

  return {
    prepare,
    discard,
    dispose,
    isLive: (token: number) => live(token),
    currentEpoch: () => epoch,
    getState: () => state,
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
