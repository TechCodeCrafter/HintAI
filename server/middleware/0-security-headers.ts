/**
 * Adds baseline security headers to every response on deployed/preview builds.
 * Runs outermost (0- prefix) so headers apply after downstream body transforms.
 */
import {
  applySecurityHeaders,
  parseHost,
} from "../../scripts/security-headers.mjs";

interface SecurityEvent {
  url: URL;
  req: { headers: Headers };
}

export default async function securityHeadersMiddleware(
  event: SecurityEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  if (!(result instanceof Response)) return result;

  const headers = new Headers(result.headers);
  const contentType = String(result.headers.get("content-type") ?? "");
  applySecurityHeaders(headers, {
    host: event.req.headers.get("x-forwarded-host") ?? event.req.headers.get("host") ?? parseHost(event.url.host),
    pathname: event.url.pathname,
    isHtmlDocument: contentType.includes("text/html"),
  });
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}
