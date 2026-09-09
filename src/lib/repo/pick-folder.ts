import { scanDirectoryHandle, type DirectoryLike, type FolderScan } from "./folder.ts";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" }) => Promise<DirectoryLike>;
};

export function canPickDirectory(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__MEETHINT_E2E__ || navigator.webdriver) return false;
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
}

export async function pickFolderScan(): Promise<FolderScan | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) return null;
  try {
    const handle = await picker.call(window, { id: "meethint-folder", mode: "read" });
    return await scanDirectoryHandle(handle);
  } catch {
    return null;
  }
}
