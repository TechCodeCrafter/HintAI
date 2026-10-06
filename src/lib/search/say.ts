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
 *
 * `allowField` is only for field questions ("what is the phone number",
 * "what is the company name") where the honest cited answer is a short
 * label:value or header ("Phone: 9931607655", "REDSHEEL"), not a sentence.
 * Everywhere else the strict sentence gates stay.
 */
export function sayable(text: string | null | undefined, allowField = false): string | null {
  if (!text) return null;
  let out = text.replace(/\s+/g, " ").trim();

  for (let pass = 0; pass < 3; pass += 1) {
    const before = out;
    out = out.replace(SOURCE_PREFACE, "").replace(HEDGE, "").trim();
    if (out === before) break;
  }

  out = out.replace(/^[,;:.\-–—]+\s*/, "").trim();
  if (allowField && isFieldLine(out)) {
    if (out.length < 4) return null;
    if (!/[A-Za-z0-9]/.test(out)) return null;
    return out.charAt(0).toUpperCase() + out.slice(1);
  }
  if (out.length < 12) return null;
  if (!/[A-Za-z]/.test(out)) return null;
  if (out.split(/\s+/).filter(Boolean).length < 3) return null;

  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * A short label:value line or header that is a legitimate cited answer for a
 * field question: "Phone: 9931607655", "Email: a@b.com", "REDSHEEL".
 * Deliberately narrow — must look like a contact label, a contact value, an
 * email, or a short single-header token.
 */
export function isFieldLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 120 || /[=;{}<>]/.test(trimmed)) return false;
  if (/^(phone|tel\.?|telephone|mobile|email|company)\s*:/i.test(trimmed)) return true;
  if (/^[A-Za-z0-9][A-Za-z0-9 .&'-]{1,60}$/.test(trimmed) && /[A-Za-z]/.test(trimmed)) {
    // Short header: 1-4 words, no sentence punctuation. "REDSHEEL" qualifies;
    // "This is the current product plan for erstuff." does not.
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length <= 4 && !/[.!?]/.test(trimmed)) return true;
  }
  if (/\+?\d[\d\s().-]{6,}\d/.test(trimmed)) return true;
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(trimmed)) return true;
  return false;
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
