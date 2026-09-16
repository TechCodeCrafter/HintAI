import { useEffect, useState } from "react";

/**
 * False on the server and on the client's first paint, then true after mount.
 * Use before rendering UI that depends on browser-only state (session cookies,
 * localStorage, etc.) so SSR markup matches the initial client hydrate.
 */
export function useClientMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
