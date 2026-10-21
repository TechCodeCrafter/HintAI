/**
 * Manual QA entry points (`/eval/viewer`, `/app?viewerqa=1`) write fixture
 * spaces into the bound account, so they exist only on the dev server and in
 * E2E builds — never in a production bundle.
 */
export const qaToolsEnabled = import.meta.env.DEV || import.meta.env.VITE_E2E === "true";
