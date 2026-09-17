import "@/lib/silence-onnx-warnings";
import { useEffect } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { BetaTelemetryBoot } from "@/components/beta-telemetry-boot";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { hydrateClientPrefs } from "@/lib/store";
import { MEETHINT_DESCRIPTION, MEETHINT_NAME } from "@/lib/brand";
import "../fonts.css";
import appCss from "../styles.css?url";
import enterpriseCss from "../styles/enterprise-redesign.css?url";

function applyDocumentTheme() {
  try {
    const stored = localStorage.getItem("meethint-theme");
    let theme = stored;
    if (theme !== "light" && theme !== "dark") {
      theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    /* private mode */
  }
}

function ClientPrefs() {
  useEffect(() => {
    applyDocumentTheme();
    hydrateClientPrefs();
  }, []);
  return null;
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: MEETHINT_NAME },
      { name: "theme-color", content: "#0b0d12" },
      { name: "description", content: MEETHINT_DESCRIPTION },
      { name: "apple-mobile-web-app-title", content: MEETHINT_NAME },
      { name: "apple-mobile-web-app-status-bar-style", content: "black" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: enterpriseCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <ClientPrefs />
        <PreviewHostBridge />
        <AuthProvider>
          <BetaTelemetryBoot />
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
