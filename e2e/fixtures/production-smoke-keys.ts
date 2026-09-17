import { expect, type Page } from "@playwright/test";

const PROVIDER_KEYS_BASE = "meethint.providerKeys";

function scopedProviderKey(accountId: string | null): string {
  if (!accountId || accountId === "dev-user") return PROVIDER_KEYS_BASE;
  const sanitized = accountId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "account";
  return `${PROVIDER_KEYS_BASE}.${sanitized}`;
}

/** Inject LLM key at runtime — never store in saved OAuth storage state. */
export async function injectSmokeOpenAiKey(page: Page, openaiKey: string) {
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("meethint.accountEpoch");
    if (!raw) return false;
    try {
      return Boolean(JSON.parse(raw).accountId);
    } catch {
      return false;
    }
  }, { timeout: 30_000 });

  const targetKey = await page.evaluate(
    ({ base, key }) => {
      const raw = localStorage.getItem("meethint.accountEpoch");
      const accountId = raw ? (JSON.parse(raw).accountId as string | null) : null;
      let storageKey = base;
      if (accountId && accountId !== "dev-user") {
        const sanitized = accountId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "account";
        storageKey = `${base}.${sanitized}`;
      }
      localStorage.setItem(storageKey, JSON.stringify({ openai: key }));
      return storageKey;
    },
    { base: PROVIDER_KEYS_BASE, key: openaiKey },
  );

  const hasKey = await page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return false;
    try {
      return Boolean(JSON.parse(raw).openai);
    } catch {
      return false;
    }
  }, targetKey);
  expect(hasKey).toBe(true);
}

export { scopedProviderKey };
