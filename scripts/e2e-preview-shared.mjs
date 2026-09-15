/** Shared preview URL for Playwright e2e and design:detect. */
export const E2E_PREVIEW_HOST = "127.0.0.1";
export const E2E_PREVIEW_PORT = 8080;
export const E2E_PREVIEW_URL = `http://${E2E_PREVIEW_HOST}:${E2E_PREVIEW_PORT}`;

export const E2E_PREVIEW_COMMAND = "MEETHINT_E2E=1 npm run dev";
/** Dev server avoids preview SSR bundle issues while auth routes are client-gated. */
export const E2E_PREVIEW_BOOT = "MEETHINT_E2E=1 npm run dev";
