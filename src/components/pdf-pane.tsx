"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getContextRepository } from "@/lib/context/service";
import { STALE_SOURCE_COPY, viewerAvailability } from "@/lib/document/viewer/currentness";
import { planHighlight } from "@/lib/document/viewer/highlight";
import { lastViewerMetric, recordViewerMetric, type ViewerLatency } from "@/lib/document/viewer/metrics";
import { createPdfRenderer, exactRectsForRange } from "@/lib/document/viewer/render";
import { evidenceForOpenTarget } from "@/lib/document/viewer/resolve";
import type { HighlightMode, ViewerBox } from "@/lib/document/viewer/types";
import { useGround } from "@/lib/store";
import { cn } from "@/lib/cn";

type PaintBox = ViewerBox | { itemIndex: number; x: number; y: number; w: number; h: number };

type PaneView = {
  page: number;
  pageCount: number;
  mode: HighlightMode | "stale";
  message: string | null;
  caption: string;
  boxes: PaintBox[];
  path: string;
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

export function PdfPane({ forceMode }: { forceMode?: HighlightMode }) {
  const target = useGround((s) => s.openDocument);
  const card = useGround((s) => s.card);
  const sources = useGround((s) => s.sources);
  const hydrationEpoch = useGround((s) => s.hydrationEpoch);
  const evidence = evidenceForOpenTarget(card, target);
  const sourcePath = sources.find((row) => row.id === target?.sourceId)?.path ?? "";
  const [view, setView] = useState<PaneView | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(target?.page ?? 1);
  const [frame, setFrame] = useState(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ReturnType<typeof createPdfRenderer> | null>(null);
  const openedKey = useRef<string | null>(null);
  const epochRef = useRef(0);

  useEffect(() => {
    setPage(target?.page ?? 1);
  }, [target?.sourceId, target?.contentHash, target?.evidenceId, target?.page]);

  useEffect(() => {
    rendererRef.current ??= createPdfRenderer();
    return () => {
      epochRef.current += 1;
      void rendererRef.current?.destroy();
      rendererRef.current = null;
      openedKey.current = null;
    };
  }, []);

  useEffect(() => {
    const pane = shellRef.current;
    if (!pane) return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setFrame((n) => n + 1), 80);
    });
    observer.observe(pane);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const token = ++epochRef.current;
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    const highlight = highlightRef.current;
    const pane = shellRef.current;
    if (!target || !canvas || !layer || !highlight || !pane) return;
    const open = target;
    const pageCanvas = canvas;
    const pageLayer = layer;
    const pageHighlight = highlight;
    const pagePane = pane;

    pageHighlight.replaceChildren();
    let cancelled = false;

    async function run() {
      setLoading(true);
      const started = performance.now();
      const latency = emptyLatency(openedKey.current !== `${open.sourceId}:${open.contentHash}`);
      const repo = getContextRepository();
      const tBlob = performance.now();
      const blob = open.contentHash ? await repo.getSourceBlob(open.sourceId, open.contentHash) : null;
      latency.blobMs = performance.now() - tBlob;
      if (cancelled || token !== epochRef.current) return;

      const document = open.contentHash
        ? ((await repo.getNormalizedDocument(open.sourceId, open.contentHash)) ?? undefined)
        : undefined;
      if (cancelled || token !== epochRef.current) return;

      const browsing = !open.evidenceId;
      const availability = browsing
        ? blob
          ? "ready"
          : "stale"
        : viewerAvailability({
            blob,
            evidence,
            document,
            requestedHash: open.contentHash,
          });
      const caption = evidence?.supportText || evidence?.sourceText || "";
      if (availability !== "ready" || !blob || (!browsing && (!evidence || !document))) {
        if (token !== epochRef.current) return;
        setView({
          page: open.page,
          pageCount: document?.pageCount ?? 0,
          mode: "stale",
          message: browsing ? "This PDF is not available to view." : STALE_SOURCE_COPY,
          caption: "",
          boxes: [],
          path: evidence?.path ?? document?.path ?? "",
        });
        setLoading(false);
        if (!browsing) {
          recordViewerMetric({
            pageRequested: open.page,
            pageOpened: open.page,
            mode: "stale",
            wrongPage: false,
            wrongText: false,
            latency: { ...latency, totalMs: performance.now() - started },
          });
          publishMetric();
        }
        return;
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (cancelled || token !== epochRef.current) return;
      const renderer = rendererRef.current ?? createPdfRenderer();
      rendererRef.current = renderer;
      const rendered = await renderer.renderPage({
        key: `${open.sourceId}:${open.contentHash}`,
        bytes,
        pageNumber: page,
        paneWidth: Math.max(pagePane.clientWidth - 16, 160),
        canvas: pageCanvas,
        textLayerEl: pageLayer,
        latency,
      });
      if (cancelled || token !== epochRef.current || !rendered) return;
      openedKey.current = `${open.sourceId}:${open.contentHash}`;

      const tHighlight = performance.now();
      const browsePath = document?.path || sourcePath;
      if (browsing || !evidence || !document) {
        paintBoxes(pageHighlight, []);
        if (token !== epochRef.current) return;
        setView({
          page: rendered.pageNumber,
          pageCount: rendered.pageCount,
          mode: "caption-only",
          message: null,
          caption: "",
          boxes: [],
          path: browsePath,
        });
        setLoading(false);
        return;
      }

      let plan = planHighlight({
        evidence,
        document,
        map: rendered.map,
        divs: rendered.textDivs,
        viewport: rendered.viewport,
        forceMode,
      });

      const boxes: PaintBox[] = [];
      if (plan.mode === "exact" && rendered.pageNumber === evidence.page) {
        const origin = pageLayer.getBoundingClientRect();
        for (const range of plan.exact) {
          const divIndex = rendered.map.divByItem[range.itemIndex];
          const div = divIndex >= 0 ? rendered.textDivs[divIndex] : undefined;
          if (!div) {
            plan = planHighlight({
              evidence,
              document,
              viewport: rendered.viewport,
              forceMode: "item-box",
            });
            boxes.length = 0;
            break;
          }
          const rects = exactRectsForRange(div, range.charStart, range.charEnd, origin);
          if (rects.length === 0) {
            plan = planHighlight({
              evidence,
              document,
              viewport: rendered.viewport,
              forceMode: "item-box",
            });
            boxes.length = 0;
            break;
          }
          for (const rect of rects) boxes.push({ itemIndex: range.itemIndex, ...rect });
        }
      }
      if (plan.mode === "item-box" && rendered.pageNumber === evidence.page) {
        boxes.push(...plan.boxes);
      }
      if (rendered.pageNumber !== evidence.page) {
        boxes.length = 0;
        plan = { ...plan, mode: "caption-only", exact: [], boxes: [] };
      }
      latency.highlightMs = performance.now() - tHighlight;
      latency.totalMs = performance.now() - started;

      paintBoxes(pageHighlight, boxes);
      const first = boxes[0];
      if (first) {
        pageHighlight.querySelector("[data-evidence-box]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }

      if (token !== epochRef.current) return;
      setView({
        page: rendered.pageNumber,
        pageCount: rendered.pageCount,
        mode: plan.mode,
        message: null,
        caption,
        boxes,
        path: evidence.path,
      });
      setLoading(false);
      recordViewerMetric({
        pageRequested: evidence.page,
        pageOpened: rendered.pageNumber,
        mode: plan.mode,
        wrongPage: rendered.pageNumber !== page,
        wrongText: false,
        latency,
      });
      publishMetric();
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [target, evidence, page, hydrationEpoch, forceMode, frame, sourcePath]);

  if (!target) return null;

  const stale = view?.mode === "stale";
  const caption = view?.caption ?? evidence?.supportText ?? "";
  const mode = view?.mode ?? "caption-only";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-pdf-pane="true">
      <div className="ground-code-name flex shrink-0 items-center justify-between gap-2">
        <span className="truncate">{view?.path || evidence?.path || sourcePath || "PDF"}</span>
        <span className="shrink-0 text-faint" data-highlight-mode={mode}>
          {stale ? "Unavailable" : modeLabel(mode)}
        </span>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1 rounded-sm px-2 text-xs text-muted enabled:hover:text-fg disabled:opacity-40"
          aria-label="Previous page"
          disabled={!view || page <= 1 || stale}
          onClick={() => setPage((n) => Math.max(1, n - 1))}
        >
          <ChevronLeft className="size-3.5" />
          Previous
        </button>
        <p className="text-xs tabular-nums text-muted" data-pdf-page={view?.page ?? page} aria-live="polite">
          Page {view?.page ?? page} of {view?.pageCount || "—"}
        </p>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1 rounded-sm px-2 text-xs text-muted enabled:hover:text-fg disabled:opacity-40"
          aria-label="Next page"
          disabled={!view || stale || page >= (view.pageCount || 1)}
          onClick={() => setPage((n) => Math.min(view?.pageCount ?? n, n + 1))}
        >
          Next
          <ChevronRight className="size-3.5" />
        </button>
      </div>
      <div ref={shellRef} className="relative min-h-0 min-w-0 flex-1 overflow-auto">
        {loading ? <p className="px-3 py-2 text-xs text-muted">Loading page…</p> : null}
        {stale ? (
          <p className="px-3 py-3 text-sm text-warn" data-pdf-state="stale">
            {view?.message ?? STALE_SOURCE_COPY}
          </p>
        ) : (
          <div
            className="pdf-page relative mx-auto"
            data-pdf-state={loading ? "loading" : "ready"}
            aria-label={caption ? `Supporting evidence: ${caption}` : "PDF page"}
          >
            <canvas ref={canvasRef} className="block" />
            <div ref={layerRef} className="textLayer pointer-events-none" />
            <div ref={highlightRef} className="pdf-highlights pointer-events-none" />
          </div>
        )}
      </div>
      {caption && !stale ? (
        <p className={cn("shrink-0 border-t border-line px-3 py-2 text-xs text-muted", mode === "caption-only" ? "" : "sr-only")}>
          <span className="text-faint">Supporting evidence · </span>
          {caption}
        </p>
      ) : null}
    </div>
  );
}

function publishMetric() {
  if (typeof window === "undefined") return;
  (window as Window & { __lastViewerMetric?: ReturnType<typeof lastViewerMetric> }).__lastViewerMetric =
    lastViewerMetric();
}

function modeLabel(mode: HighlightMode | "stale"): string {
  if (mode === "exact") return "Exact highlight";
  if (mode === "item-box") return "Approximate highlight";
  if (mode === "stale") return "Unavailable";
  return "Page only";
}

function paintBoxes(layer: HTMLElement, boxes: PaintBox[]) {
  layer.replaceChildren();
  for (const box of boxes) {
    const mark = layer.ownerDocument.createElement("div");
    mark.dataset.evidenceBox = String(box.itemIndex);
    mark.className = "pdf-evidence-box";
    mark.style.left = `${box.x}px`;
    mark.style.top = `${box.y}px`;
    mark.style.width = `${box.w}px`;
    mark.style.height = `${box.h}px`;
    layer.append(mark);
  }
}
