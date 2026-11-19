import { scanDirectoryHandle, type DirectoryLike, type FolderScan } from "./folder.ts";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" }) => Promise<DirectoryLike>;
};

export function canPickDirectory(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__MEETHINT_E2E__ || navigator.webdriver) return false;
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
}

/**
 * What the native folder picker produced. "cancelled" means the person closed
 * the dialog; "unavailable" means the picker refused to open or could not be
 * read (embedded frame, policy, permission), so the caller should fall back to
 * the plain folder input instead of doing nothing.
 */
export type FolderPickResult =
  | { status: "picked"; scan: FolderScan }
  | { status: "cancelled" }
  | { status: "unavailable" };

export async function pickFolderScan(): Promise<FolderPickResult> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) return { status: "unavailable" };
  let handle: DirectoryLike;
  try {
    handle = await picker.call(window, { id: "meethint-folder", mode: "read" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { status: "cancelled" };
    return { status: "unavailable" };
  }
  try {
    return { status: "picked", scan: await scanDirectoryHandle(handle) };
  } catch {
    return { status: "unavailable" };
  }
}
