/**
 * Text-layer mapping for pdfjs-dist 6.3.289.
 *
 * Recommended APIs (this pin, not older cookbook samples):
 *   page.render({ canvasContext, canvas, viewport }) → RenderTask
 *   new TextLayer({ textContentSource, container, viewport }).render()
 *   page.getTextContent() as TextContent (same object can feed the layer)
 *
 * After TextLayer.render():
 *   textDivs[k]              — HTMLElement for the k-th item with `str` defined
 *   textContentItemsStr[k]   — that item's `str`
 *
 * Invariant (verified against 6.3.289 TextLayer.#processItems):
 *   One getTextContent item with `str !== undefined` → exactly one textDiv.
 *   One textDiv is never the merge of multiple items.
 *   Marked-content items (`str === undefined`) create wrapper spans and are
 *   not in textDivs.
 *   Empty `str` still allocates a textDiv but may not be appended.
 *   hasEOL appends an extra <br> after the span.
 *
 * Therefore:
 *   itemIndex === textLayer.container.children[itemIndex]   is FALSE
 *   itemIndex on NormalizedDocument is the raw getTextContent().items index
 *   (same as extractPdfItems). Map through textDivIndexForItem().
 *
 * Cancellation: TextLayer.cancel() rejects the render promise and cancels
 * the stream reader. RenderTask.cancel() aborts page rasterization.
 * PDFDocumentProxy.destroy() releases the document. TextLayer.cleanup() is
 * process-global (font/canvas cache) — do not call it per page.
 */

export type RawTextItem = {
  str?: string;
};

export type TextLayerMap = {
  /** textDivs index for each raw itemIndex, or -1 when the item has no str. */
  divByItem: number[];
  /** raw itemIndex for each textDivs entry. */
  itemByDiv: number[];
  /** True when every mapped div's text equals the corresponding item.str. */
  stringsMatch: boolean;
};

export function textDivIndexForItem(rawItems: RawTextItem[], itemIndex: number): number | null {
  if (itemIndex < 0 || itemIndex >= rawItems.length) return null;
  if (rawItems[itemIndex]?.str === undefined) return null;
  let div = 0;
  for (let i = 0; i < itemIndex; i += 1) {
    if (rawItems[i]?.str !== undefined) div += 1;
  }
  return div;
}

export function buildTextLayerMap(
  rawItems: RawTextItem[],
  textDivs: Array<{ textContent: string | null }>,
  textContentItemsStr?: string[],
): TextLayerMap {
  const divByItem: number[] = rawItems.map((_, index) => textDivIndexForItem(rawItems, index) ?? -1);
  const itemByDiv: number[] = [];
  rawItems.forEach((item, itemIndex) => {
    if (item.str !== undefined) itemByDiv.push(itemIndex);
  });

  let stringsMatch = textDivs.length === itemByDiv.length;
  if (textContentItemsStr && textContentItemsStr.length !== itemByDiv.length) stringsMatch = false;
  for (let div = 0; div < itemByDiv.length; div += 1) {
    const item = rawItems[itemByDiv[div]];
    const expected = item?.str ?? "";
    if (textContentItemsStr && textContentItemsStr[div] !== expected) stringsMatch = false;
    if ((textDivs[div]?.textContent ?? "") !== expected) stringsMatch = false;
  }
  return { divByItem, itemByDiv, stringsMatch };
}

export function mappedDivForRange(
  map: TextLayerMap,
  itemIndex: number,
  itemStr: string,
  divs: Array<{ textContent: string | null }>,
): { divIndex: number; text: string } | null {
  const divIndex = map.divByItem[itemIndex];
  if (divIndex == null || divIndex < 0) return null;
  const text = divs[divIndex]?.textContent ?? "";
  if (text !== itemStr) return null;
  return { divIndex, text };
}
