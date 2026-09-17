import fs from "node:fs";

type StorageCookie = {
  name: string;
  domain?: string;
  path?: string;
  url?: string;
  value: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type StorageState = {
  cookies: StorageCookie[];
  origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
};

export function readSmokeSessionToken(path: string): string {
  const state = JSON.parse(fs.readFileSync(path, "utf8")) as StorageState;
  const cookie = state.cookies.find((c) => c.name.includes("session_token"));
  const raw = cookie?.value?.trim();
  if (!raw) throw new Error(`No session token in ${path} — re-run capture-smoke-auth`);
  return decodeURIComponent(raw);
}

/** Load OAuth storage state with __Host- cookies Playwright can restore. */
export function loadSmokeStorageState(path: string): StorageState {
  const state = JSON.parse(fs.readFileSync(path, "utf8")) as StorageState;
  return {
    ...state,
    cookies: state.cookies.map((cookie) => {
      if (!cookie.name.startsWith("__Host-")) return cookie;
      const cookiePath = cookie.path ?? "/";
      const host = cookie.domain?.replace(/^\./, "") ?? "www.meethint.ai";
      const { domain: _domain, path: _path, ...rest } = cookie;
      return {
        ...rest,
        url: `https://${host}${cookiePath.startsWith("/") ? cookiePath : `/${cookiePath}`}`,
      };
    }),
  };
}
