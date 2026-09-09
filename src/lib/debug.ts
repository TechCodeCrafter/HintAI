/** LLM request tracing. Off unless VITE_DEBUG_LLM or DEBUG_LLM is "true". */
export function llmDebug(...args: unknown[]): void {
  if (!isLlmDebug()) return;
  console.info(...args);
}

export function isLlmDebug(): boolean {
  return flag("VITE_DEBUG_LLM") || flag("DEBUG_LLM");
}

function flag(name: string): boolean {
  try {
    const value = (import.meta as { env?: Record<string, unknown> }).env?.[name];
    if (value === true || value === "true") return true;
  } catch {
    /* node --test has no Vite env */
  }
  return typeof process !== "undefined" && process.env?.[name] === "true";
}
