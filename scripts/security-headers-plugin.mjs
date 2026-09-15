/**
 * Vite dev/preview middleware: same baseline headers as server/middleware/0-security-headers.ts.
 */
import { applySecurityHeaders, parseHost } from "./security-headers.mjs";

function requestHost(req) {
  const forwarded = req.headers["x-forwarded-host"];
  const host = forwarded ?? req.headers.host ?? req.headers[":authority"];
  return Array.isArray(host) ? host[0] : host;
}

function attachSecurityHeaders(middlewares) {
  middlewares.use((req, res, next) => {
    const pathOnly = (req.url ?? "").split("?", 1)[0] ?? "/";
    const host = requestHost(req);
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = (statusCode, ...rest) => {
      applySecurityHeaders(res, { host: parseHost(host), pathname: pathOnly });
      return originalWriteHead(statusCode, ...rest);
    };
    const originalEnd = res.end.bind(res);
    res.end = (...args) => {
      if (!res.headersSent) {
        applySecurityHeaders(res, { host: parseHost(host), pathname: pathOnly });
      }
      return originalEnd(...args);
    };
    next();
  });
}

export function securityHeadersPlugin() {
  return {
    name: "meethint:security-headers",
    configureServer(server) {
      attachSecurityHeaders(server.middlewares);
    },
    configurePreviewServer(server) {
      attachSecurityHeaders(server.middlewares);
    },
  };
}
