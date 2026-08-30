export type Theme = "light" | "dark";

const KEY = "meethint-theme";

export const THEME_BOOT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}})();`;

export function readTheme(): Theme {
  if (typeof document !== "undefined") {
    const fromDom = document.documentElement.dataset.theme;
    if (fromDom === "light" || fromDom === "dark") return fromDom;
  }
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  }
  if (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f4f5f7" : "#07090c");
  localStorage.setItem(KEY, theme);
}
