import { fileChunkId, type BuildChunksOptions } from "../context/source-identity.ts";
import type { CodeParser } from "./parser.ts";
import { computeLineOffsets, inferLanguage } from "./parser.ts";
import type { Chunk } from "./types.ts";

/**
 * Symbol-aligned chunks for one file. Null means the caller must window it —
 * no symbols, unsupported language, or the parser gave up.
 */
export function buildStructuredChunks(
  file: { path: string; content: string },
  parser: CodeParser,
  options?: BuildChunksOptions,
): Chunk[] | null {
  let symbols: ReturnType<CodeParser["parse"]>;
  try {
    symbols = parser.parse(file);
  } catch {
    return null;
  }
  if (!symbols || symbols.length === 0) return null;

  const chunks: Chunk[] = [];
  computeLineOffsets(file.content);
  const language = inferLanguage(file.path);

  for (const sym of symbols) {
    const chunkStartLine = sym.docstring ? sym.docstring.startLine : sym.startLine;
    const chunkStartOffset = sym.docstring ? sym.docstring.startOffset : sym.startOffset;
    const chunkEndLine = sym.endLine;
    const chunkEndOffset = sym.endOffset;
    if (chunkStartOffset < 0 || chunkEndOffset > file.content.length || chunkStartOffset >= chunkEndOffset) {
      continue;
    }
    const text = file.content.slice(chunkStartOffset, chunkEndOffset);
    if (!text.trim()) continue;
    const rangeKey = `${sym.name}@${chunkStartLine}`;
    chunks.push({
      id: options?.chunkScope
        ? fileChunkId(options.chunkScope, file.path, rangeKey)
        : `${file.path}:${rangeKey}`,
      kind: "code",
      sourceId: options?.sourceId ?? options?.chunkScope?.sourceId,
      path: file.path,
      startLine: chunkStartLine,
      endLine: chunkEndLine,
      startOffset: chunkStartOffset,
      text,
      symbol: sym.name,
      symbolKind: sym.kind,
      language,
    });
  }

  return chunks.length > 0 ? chunks : null;
}
