import type { PDFDocumentProxy } from "pdfjs-dist";

type Pdfjs = typeof import("pdfjs-dist");

let pdfjs: Pdfjs | null = null;
let workerReady = false;
let documentOpenCount = 0;

export function pdfjsDocumentOpenCount(): number {
  return documentOpenCount;
}

export function resetPdfjsDocumentOpenCount() {
  documentOpenCount = 0;
}

export async function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjs) {
    pdfjs =
      typeof window === "undefined"
        ? ((await import("pdfjs-dist/legacy/build/pdf.mjs")) as Pdfjs)
        : await import("pdfjs-dist");
  }
  if (!workerReady) {
    await configureWorker(pdfjs);
    workerReady = true;
  }
  return pdfjs;
}

async function configureWorker(mod: Pdfjs) {
  if (typeof window !== "undefined") {
    const { pdfWorkerSrc } = await import("./worker.browser.ts");
    mod.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
    return;
  }
  try {
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const require = createRequire(import.meta.url);
    mod.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
    ).href;
  } catch {
    // Main-thread fallback: getDocument still runs without a worker URL.
  }
}

export async function openPdfDocument(data: Uint8Array): Promise<PDFDocumentProxy> {
  documentOpenCount += 1;
  const mod = await loadPdfjs();
  const copy = data.slice();
  let passwordRequested = false;
  const task = mod.getDocument({
    data: copy,
    password: "",
    useSystemFonts: true,
    verbosity: 0,
    stopAtErrors: false,
  });
  task.onPassword = () => {
    passwordRequested = true;
    void task.destroy();
  };
  try {
    return await task.promise;
  } catch (error) {
    if (passwordRequested || isPasswordError(error)) {
      const wrapped = new Error("encrypted");
      wrapped.name = "PdfEncryptedError";
      throw wrapped;
    }
    throw error;
  }
}

function isPasswordError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "PasswordException" || /password/i.test(message);
}
