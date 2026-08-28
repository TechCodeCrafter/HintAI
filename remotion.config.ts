import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Config } from "@remotion/cli/config";

/**
 * Playwright is already installed for browser QA and ships the same
 * chrome-headless-shell Remotion renders with, so reuse it instead of pulling a
 * second ~200MB browser. Falls through to Remotion's own download if absent.
 */
const playwrightShell = path.join(
  homedir(),
  "Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);
if (existsSync(playwrightShell)) Config.setBrowserExecutable(playwrightShell);

/**
 * Remotion bundles the demo composition with its own webpack, which knows
 * nothing about the app's `@/` path alias — the demo reuses the real
 * MeetHintMark component, so the alias has to be taught here too.
 */
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...(config.resolve?.alias ?? {}),
      "@": path.join(process.cwd(), "src"),
    },
  },
}));

Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
// Mostly-static dark frames compress well; 23 keeps text crisp at a sane size.
Config.setCrf(23);

/**
 * The score is a render input, not a site asset: an 8MB wav in public/ would
 * deploy to every visitor for no reason. staticFile() resolves against this
 * directory instead.
 */
Config.setPublicDir(path.join(process.cwd(), "assets/remotion"));
