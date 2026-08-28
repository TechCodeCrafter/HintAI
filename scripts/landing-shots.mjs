#!/usr/bin/env node
/**
 * Renders /soon and captures what a visitor actually sees: desktop, mobile, and
 * the two states of the demo card that carry the pitch — an answer with its
 * citation, and the beat where the material does not support one.
 *
 * A 200 from the server proves nothing about a landing page; the point here is
 * to look at it, and to fail loudly on console errors or horizontal overflow.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const TARGET = process.env.SHOT_URL ?? "http://127.0.0.1:8080/soon";
const OUT = new URL("../screenshots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [];
const shots = [];

async function shoot(name, viewport, work) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[${name}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${name}] ${err.message}`));
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(900);
  const path = `${OUT}${name}.png`;
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (work) await work(page);
  await page.screenshot({ path, fullPage: !work });
  shots.push({ name, path, overflow });
  await page.close();
}

await shoot("landing-desktop", { width: 1440, height: 900 });
await shoot("landing-mobile", { width: 390, height: 844 });

// The card cycles on its own; wait for the state rather than guessing a delay.
await shoot("card-answer", { width: 1280, height: 820 }, async (page) => {
  await page.getByText("lambda_function.py:83").first().waitFor({ timeout: 30000 });
});
// Citations are path + fact on one row at desktop and stacked at 390px.
await shoot("card-mobile", { width: 390, height: 844 }, async (page) => {
  const cite = page.getByText("lambda_function.py:83").first();
  await cite.waitFor({ timeout: 30000 });
  await cite.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(250);
});
await shoot("card-no-answer", { width: 1280, height: 820 }, async (page) => {
  await page.getByText("Not in your material").waitFor({ timeout: 60000 });
});

// The form is the only thing on the page a visitor can do. Prove it confirms.
await shoot("form-confirmed", { width: 1280, height: 820 }, async (page) => {
  const cta = page.getByRole("button", { name: /join the private beta/i }).first();
  if (!(await cta.isDisabled())) throw new Error("CTA enabled before a valid email");
  await page.getByPlaceholder("Enter your email").first().fill("someone@example.com");
  await cta.click();
  await page.getByRole("status").first().waitFor({ timeout: 10000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("status").first().waitFor({ timeout: 10000 });
});

await browser.close();

for (const shot of shots) {
  console.log(`${shot.name.padEnd(18)} ${shot.overflow ? "HORIZONTAL OVERFLOW" : "no overflow"}  ${shot.path}`);
}
console.log(`console errors      ${errors.length}`);
for (const error of errors) console.log(`  ${error}`);
process.exitCode = errors.length || shots.some((s) => s.overflow) ? 1 : 0;
