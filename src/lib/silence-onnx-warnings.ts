/**
 * @huggingface/transformers and onnxruntime-web log optimizer noise while the
 * MiniLM embedder loads. Not fatal — it just fills the /app console.
 */
const NOISE = /CleanUnusedInitializers|onnxruntime/i;

function isOnnxNoise(args: unknown[]): boolean {
  return args.some((arg) => typeof arg === "string" && NOISE.test(arg));
}

export function silenceOnnxWarnings(): void {
  if (typeof window === "undefined") return;
  const marked = window as Window & { __meethintOnnxWarnSilenced?: boolean };
  if (marked.__meethintOnnxWarnSilenced) return;
  marked.__meethintOnnxWarnSilenced = true;

  const originalConsoleWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (isOnnxNoise(args)) return;
    originalConsoleWarn(...args);
  };
}

silenceOnnxWarnings();
