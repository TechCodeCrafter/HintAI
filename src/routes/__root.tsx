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

function ClientPrefs() {
  useEffect(() => {
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
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" data-theme="dark" suppressHydrationWarning>
      <head>
        <script src="/theme-boot.js" />
        <HeadContent />
      </head>
      <body>
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
