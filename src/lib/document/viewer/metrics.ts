import type { HighlightMode } from "./types.ts";

export type ViewerLatency = {
  blobMs: number;
  openMs: number;
  pageMs: number;
  textLayerMs: number;
  highlightMs: number;
  totalMs: number;
  cold: boolean;
};

export type ViewerMetricEvent = {
  pageRequested: number;
  pageOpened: number;
  mode: HighlightMode | "stale";
  wrongPage: boolean;
  wrongText: boolean;
  latency: ViewerLatency;
};

export type ViewerMetricsSnapshot = {
  pageOpenAttempts: number;
  correctPageOpen: number;
  correctPageOpenRate: number;
  exact: number;
  itemBox: number;
  captionOnly: number;
  stale: number;
  exactRate: number;
  itemBoxRate: number;
  captionOnlyRate: number;
  wrongPage: number;
  wrongText: number;
  latencies: ViewerLatency[];
};

const events: ViewerMetricEvent[] = [];

export function resetViewerMetrics() {
  events.length = 0;
}

export function recordViewerMetric(event: ViewerMetricEvent) {
  events.push(event);
}

export function lastViewerMetric(): ViewerMetricEvent | undefined {
  return events.at(-1);
}

export function viewerMetricsSnapshot(): ViewerMetricsSnapshot {
  const pageOpenAttempts = events.length;
  const correctPageOpen = events.filter((event) => event.pageOpened === event.pageRequested).length;
  const painted = events.filter((event) => event.mode !== "stale");
  const exact = painted.filter((event) => event.mode === "exact").length;
  const itemBox = painted.filter((event) => event.mode === "item-box").length;
  const captionOnly = painted.filter((event) => event.mode === "caption-only").length;
  const stale = events.filter((event) => event.mode === "stale").length;
  const denom = painted.length || 1;
  return {
    pageOpenAttempts,
    correctPageOpen,
    correctPageOpenRate: pageOpenAttempts === 0 ? 1 : correctPageOpen / pageOpenAttempts,
    exact,
    itemBox,
    captionOnly,
    stale,
    exactRate: painted.length === 0 ? 0 : exact / denom,
    itemBoxRate: painted.length === 0 ? 0 : itemBox / denom,
    captionOnlyRate: painted.length === 0 ? 0 : captionOnly / denom,
    wrongPage: events.filter((event) => event.wrongPage).length,
    wrongText: events.filter((event) => event.wrongText).length,
    latencies: events.map((event) => event.latency),
  };
}
