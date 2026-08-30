import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import { openPdfDocument } from "../pdf/pdfjs.ts";
import { buildTextLayerMap, type TextLayerMap } from "./map.ts";
import type { ViewerLatency } from "./metrics.ts";

export const MAX_PDF_SCALE = 2.25;
export const MIN_PDF_SCALE = 0.6;

export type RenderedPdfPage = {
  pageNumber: number;
  pageCount: number;
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
  map: TextLayerMap;
  rawItems: Array<{ str?: string }>;
  textDivs: HTMLElement[];
  viewport: { convertToViewportPoint: (x: number, y: number) => number[] };
};

type CachedDoc = {
  key: string;
  pdf: PDFDocumentProxy;
};

export function scaleForPane(pageWidthAt1: number, paneWidth: number): number {
  if (pageWidthAt1 <= 0 || paneWidth <= 0) return 1;
  return Math.min(MAX_PDF_SCALE, Math.max(MIN_PDF_SCALE, paneWidth / pageWidthAt1));
}

export function createPdfRenderer() {
  let cached: CachedDoc | null = null;
  let renderTask: RenderTask | null = null;
  let textLayer: TextLayer | null = null;
  let epoch = 0;

  function nextEpoch(): number {
    epoch += 1;
    return epoch;
  }

  async function cancelInFlight() {
    try {
      renderTask?.cancel();
    } catch {
      /* already finished */
    }
    renderTask = null;
    try {
      textLayer?.cancel();
    } catch {
      /* already finished */
    }
    textLayer = null;
  }

  async function openDocument(key: string, bytes: Uint8Array): Promise<PDFDocumentProxy> {
    if (cached?.key === key) return cached.pdf;
    if (cached) {
      await destroyPdf(cached.pdf);
      cached = null;
    }
    const pdf = await openPdfDocument(bytes);
    cached = { key, pdf };
    return pdf;
  }

  async function renderPage(args: {
    key: string;
    bytes: Uint8Array;
    pageNumber: number;
    paneWidth: number;
    canvas: HTMLCanvasElement;
    textLayerEl: HTMLElement;
    latency: ViewerLatency;
  }): Promise<RenderedPdfPage | null> {
    const token = nextEpoch();
    await cancelInFlight();
    const tOpen = now();
    const pdf = await openDocument(args.key, args.bytes);
    args.latency.openMs += now() - tOpen;
    if (token !== epoch) return null;

    const pageCount = pdf.numPages;
    const pageNumber = Math.min(Math.max(1, args.pageNumber), pageCount);
    const page = await pdf.getPage(pageNumber);
    if (token !== epoch) return null;

    const base = page.getViewport({ scale: 1 });
    const scale = scaleForPane(base.width, args.paneWidth);
    const viewport = page.getViewport({ scale });

    const canvas = args.canvas;
    const outputScale = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);

    const tPage = now();
    renderTask = page.render({ canvasContext: ctx, canvas, viewport });
    try {
      await renderTask.promise;
    } catch (error) {
      if (isCancelled(error) || token !== epoch) return null;
      throw error;
    } finally {
      renderTask = null;
    }
    args.latency.pageMs += now() - tPage;
    if (token !== epoch) return null;

    const textContent = await page.getTextContent();
    if (token !== epoch) return null;
    const container = args.textLayerEl;
    container.replaceChildren();
    container.style.setProperty("--total-scale-factor", String(scale));
    container.style.setProperty("--scale-round-x", "1px");
    container.style.setProperty("--scale-round-y", "1px");
    container.style.width = `${Math.floor(viewport.width)}px`;
    container.style.height = `${Math.floor(viewport.height)}px`;

    const tLayer = now();
    textLayer = new TextLayer({
      textContentSource: textContent,
      container,
      viewport,
    });
    try {
      await textLayer.render();
    } catch (error) {
      if (isCancelled(error) || token !== epoch) return null;
      throw error;
    }
    args.latency.textLayerMs += now() - tLayer;
    if (token !== epoch) return null;

    const rawItems = textContent.items as Array<{ str?: string }>;
    const textDivs = textLayer.textDivs;
    const map = buildTextLayerMap(rawItems, textDivs, textLayer.textContentItemsStr);
    return {
      pageNumber,
      pageCount,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      scale,
      map,
      rawItems,
      textDivs,
      viewport,
    };
  }

  async function destroy() {
    nextEpoch();
    await cancelInFlight();
    if (cached) {
      await destroyPdf(cached.pdf);
      cached = null;
    }
  }

  return { renderPage, destroy, currentEpoch: () => epoch };
}

export function exactRectsForRange(
  div: HTMLElement,
  charStart: number,
  charEnd: number,
  origin: DOMRect,
): Array<{ x: number; y: number; w: number; h: number }> {
  const node = firstTextNode(div);
  if (!node || !node.textContent) return [];
  const length = node.textContent.length;
  if (charStart < 0 || charEnd > length || charEnd <= charStart) return [];
  const range = div.ownerDocument.createRange();
  range.setStart(node, charStart);
  range.setEnd(node, charEnd);
  return [...range.getClientRects()]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      w: rect.width,
      h: rect.height,
    }));
}

function firstTextNode(el: HTMLElement): Text | null {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent) return child as Text;
  }
  return null;
}

async function destroyPdf(pdf: PDFDocumentProxy) {
  try {
    await pdf.cleanup();
  } catch {
    /* already released */
  }
  try {
    await pdf.loadingTask.destroy();
  } catch {
    /* already destroyed */
  }
}

function isCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "RenderingCancelledException" || /cancel/i.test(message);
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
