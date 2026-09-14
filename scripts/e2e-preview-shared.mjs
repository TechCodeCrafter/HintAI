/** Shared preview URL for Playwright e2e and design:detect. */
export const E2E_PREVIEW_HOST = "127.0.0.1";
export const E2E_PREVIEW_PORT = 4173;
export const E2E_PREVIEW_URL = `http://${E2E_PREVIEW_HOST}:${E2E_PREVIEW_PORT}`;

export const E2E_PREVIEW_COMMAND = "npm run preview:e2e";
export const E2E_PREVIEW_BOOT = "npm run build && npm run preview:e2e";
/** Auth-on funnel lock: separate build so VITE_AUTH_ENABLED is baked true. */
export const E2E_PREVIEW_BOOT_AUTH_ON =
  "VITE_AUTH_ENABLED=true npm run build && VITE_AUTH_ENABLED=true MEETHINT_E2E=1 npm run preview:e2e";
