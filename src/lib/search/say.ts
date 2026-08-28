/**
 * The Card is the next thing to say out loud, so a line that opens by narrating
 * its own sources is not usable. Strip those openings; reject what is left if it
 * no longer carries an answer.
 */

const SOURCE_PREFACE =
  /^(?:well,?\s+|so,?\s+|ok(?:ay)?,?\s+)?(?:based (?:up)?on|according to|as per|per|from|in|looking at|after reviewing)\s+(?:the\s+)?(?:provided\s+|given\s+|loaded\s+|attached\s+|retrieved\s+)?(?:repository|repo|codebase|code ?base|code|context|documentation|docs|evidence|material|excerpts?|snippets?|files?|chunks?)\b[^,.;:]*[,.;:]?\s*/i;

const HEDGE =
  /^(?:it\s+(?:appears|seems|looks like)(?:\s+that)?|the\s+(?:documentation|docs|repository|repo|code ?base|code|evidence|context|material)\s+(?:suggests?|shows?|indicates?|says?|states?)(?:\s+that)?|there\s+(?:appears|seems)\s+to\s+be|i\s+(?:think|believe)(?:\s+that)?|this\s+(?:suggests?|indicates?)(?:\s+that)?)\s*/i;

/**
 * Normalizes a candidate spoken line. Returns null when nothing sayable is left,
 * which the callers treat as "stay silent".
 */
export function sayable(text: string | null | undefined): string | null {
  if (!text) return null;
  let out = text.replace(/\s+/g, " ").trim();

  for (let pass = 0; pass < 3; pass += 1) {
    const before = out;
    out = out.replace(SOURCE_PREFACE, "").replace(HEDGE, "").trim();
    if (out === before) break;
  }

  out = out.replace(/^[,;:.\-–—]+\s*/, "").trim();
  if (out.length < 12) return null;
  if (!/[A-Za-z]/.test(out)) return null;
  if (out.split(/\s+/).filter(Boolean).length < 3) return null;

  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * Pulls the declared name out of a source line so a Card can point at the thing
 * that handles the question rather than only naming the file.
 */
export function declaredName(line: string): string | null {
  const keyword = line.match(
    /\b(?:function|const|let|var|class|def|interface|type|enum|struct|fn|trait|module|namespace)\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
  );
  if (keyword?.[1]) return keyword[1];

  const assigned = line.match(/^\s*(?:export\s+)?(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]{2,})\s*[=(]/);
  if (assigned?.[1] && !/^(?:if|for|while|switch|return|import|export|await|new)$/.test(assigned[1])) {
    return assigned[1];
  }

  const decorated = line.match(/^\s*@[A-Za-z_$][A-Za-z0-9_$.]*\s*\(?\s*["']?([A-Za-z0-9_/-]{3,})/);
  return decorated?.[1] ?? null;
}
