import { chromium } from "playwright";

const baseURL = (process.env.PLAYWRIGHT_BASE_URL ?? "https://www.meethint.ai").replace(/\/$/, "");

/** Read Better Auth session from a saved Chrome smoke profile. */
export async function readProfileSession(profileDir) {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
    baseURL,
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("/home", { waitUntil: "domcontentloaded" });
    const session = await page.evaluate(async () => {
      const response = await fetch("/api/auth/get-session", { credentials: "include" });
      return response.json();
    });
    return {
      email: session?.user?.email ?? "",
      id: session?.user?.id ?? "",
    };
  } finally {
    await context.close();
  }
}
