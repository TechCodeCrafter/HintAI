import { createFileRoute } from "@tanstack/react-router";

const PRODUCTION_HOSTS = new Set(["meethint.ai", "www.meethint.ai"]);

/** Lightweight deploy check — is OAuth configured for this host? */
export const Route = createFileRoute("/api/auth/status")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const host = new URL(request.url).hostname.toLowerCase();
        const onProduction = PRODUCTION_HOSTS.has(host);
        const clientId = process.env.GROK_AUTH_CLIENT_ID?.trim() || "grok_preview";
        const oauthReady = !onProduction || clientId !== "grok_preview";
        return Response.json({
          oauthReady,
          reason: oauthReady ? null : "missing-production-oauth-client",
        });
      },
    },
  },
});
