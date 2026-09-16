import { createFileRoute } from "@tanstack/react-router";

const PRODUCTION_HOSTS = new Set(["meethint.ai", "www.meethint.ai"]);

/** Lightweight deploy check — is OAuth configured for this host? */
export const Route = createFileRoute("/api/auth/status")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const host = new URL(request.url).hostname.toLowerCase();
        const onProduction = PRODUCTION_HOSTS.has(host);
        const googleDirect = Boolean(
          process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim(),
        );
        const clientId = process.env.GROK_AUTH_CLIENT_ID?.trim() || "grok_preview";
        const grokReady = !onProduction || clientId !== "grok_preview";
        const oauthReady = googleDirect || grokReady;
        return Response.json({
          oauthReady,
          googleDirect,
          reason: oauthReady ? null : "missing-production-oauth-client",
        });
      },
    },
  },
});
