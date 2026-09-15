import { expect, test } from "@playwright/test";

const TRUST_PATHS = ["/privacy", "/terms", "/security", "/contact"];
const REQUIRED_HEADERS = [
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

test.describe("domain reputation (Phase A)", () => {
  for (const path of TRUST_PATHS) {
    test(`${path} returns 200 with MeetHint title`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("trust-page")).toBeVisible();
      await expect(page).toHaveTitle(/MeetHint/);
    });
  }

  test("/.well-known/security.txt returns 200", async ({ request }) => {
    const res = await request.get("/.well-known/security.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/^Contact:/m);
    expect(body).toMatch(/github\.com\/TechCodeCrafter\/HintAI\/security\/advisories\/new/);
    expect(body).not.toMatch(/^Contact: mailto:security@meethint\.ai/m);
  });

  test("landing HTML has no grok.com executable scripts", async ({ page }) => {
    await page.goto("/");
    const html = await page.content();
    expect(html).not.toMatch(/https:\/\/grok\.com\/grok-app-builder\/extensions\.js/);
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
  });

  test("landing footer links to trust routes", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByTestId("landing-footer-trust-nav");
    for (const path of TRUST_PATHS) {
      await expect(nav.locator(`a[href="${path}"]`)).toBeVisible();
    }
  });

  test("responses include baseline security headers", async ({ request }) => {
    const res = await request.get("/");
    for (const header of REQUIRED_HEADERS) {
      expect(res.headers()[header], `missing ${header}`).toBeTruthy();
    }
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).not.toMatch(/script-src[^;]*\*/);
    expect(csp).not.toMatch(/grok\.com/);
  });
});
