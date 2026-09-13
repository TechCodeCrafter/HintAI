import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

import { readWavMono16 } from "./wav-pcm";

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WHY_RETRY_WAV = path.join(FIXTURES_DIR, "why-retry.wav");

/** Real hear → gate → answer path — no craftCard / routeSearchAnswer mocks. */
export async function installAudioPath(page: Page) {
  await page.addInitScript(() => {
    window.__MEETHINT_E2E__ = true;
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
    Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
    // Mic-only: never block on the tab-share picker during automated runs.
    if (navigator.mediaDevices?.getDisplayMedia) {
      navigator.mediaDevices.getDisplayMedia = async () => {
        throw new DOMException("Tab share skipped in e2e", "NotAllowedError");
      };
    }
  });
  await page.context().grantPermissions(["microphone"]);
}

export async function openAudioCockpit(page: Page) {
  await installAudioPath(page);
  await page.goto("/home");
  await expect(page.getByTestId("home-proof-chips")).toBeVisible({ timeout: 30000 });
  await page.goto("/app");
  await expect(page.getByTestId("cockpit")).toHaveAttribute("data-context-status", "ready", {
    timeout: 30000,
  });
  await page.evaluate(() => {
    window.__groundFlight?.reset();
  });
}

/** Whisper worker must finish booting before Listen can transcribe. */
export async function waitForAsrWarmup(page: Page) {
  await expect(async () => {
    const body = await page.getByTestId("cockpit").innerText();
    expect(body).not.toMatch(/Loading captions|Downloading captions/i);
  }).toPass({ timeout: 120000 });
}

export async function clickListen(page: Page) {
  const listen = page.getByRole("button", { name: /^Listen$/i });
  await listen.click();
  await expect(page.getByRole("button", { name: /Stop listen/i })).toBeVisible({ timeout: 30000 });
  // Fake mic WAV loops; give VAD one full speech→silence cycle before asserting.
  await page.waitForTimeout(1500);
}

export type FlightAnswerRecord = {
  kind: "answer";
  tier: string;
  latency: { retrieveMs: number; llmMs: number; verifyMs: number; totalMs: number };
  query: string;
};

export async function readFlightRecords(page: Page): Promise<FlightAnswerRecord[]> {
  return page.evaluate(() => {
    const fromHook = window.__groundFlight?.records() ?? [];
    if (fromHook.length > 0) return fromHook as FlightAnswerRecord[];
    const raw = localStorage.getItem("meethint.flightLog");
    if (!raw) return [];
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FlightAnswerRecord);
  });
}

/** Wait for the spoken question in Room; fall back to Plan B PCM inject if fake mic is flaky. */
export async function waitForRetryTranscript(page: Page) {
  const turns = page.getByTestId("room-turn");
  try {
    await expect(async () => {
      await expect(turns.filter({ hasText: /retry/i })).toHaveCount(1);
    }).toPass({ timeout: 90000 });
  } catch {
    const pcm = readWavMono16(WHY_RETRY_WAV);
    await page.evaluate((samples) => {
      if (!window.__injectUtterance) throw new Error("__injectUtterance unavailable (VITE_E2E build)");
      window.__injectUtterance(new Float32Array(samples), "mic");
    }, Array.from(pcm));
    await expect(turns.filter({ hasText: /retry/i })).toHaveCount(1, { timeout: 90000 });
  }
}

/** Known ASR junk on room noise — the "Day of baby" class from manual runs. */
export const NOISE_HALLUCINATION =
  /day of baby|thanks for watching|subtitles by|subscribe|you$/i;

export async function readThemTranscriptLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const lines: string[] = [];
    for (const turn of document.querySelectorAll('[data-testid="room-turn"]')) {
      const label = turn.querySelector(".ground-hint")?.textContent?.trim();
      if (label !== "They") continue;
      const text = turn.querySelector(".ground-transcript")?.textContent?.trim() ?? "";
      if (text) lines.push(text);
    }
    return lines;
  });
}

export async function readDroppedUtterances(page: Page): Promise<number> {
  return page.evaluate(() => window.__groundFlight?.droppedUtterances?.() ?? 0);
}

export async function waitForAnswerOutcome(page: Page) {
  await expect(async () => {
    const say = page.getByTestId("card-say");
    const reason = page.getByTestId("card-reason");
    const hasSay = (await say.count()) > 0 && (await say.isVisible());
    const hasReason = (await reason.count()) > 0 && (await reason.isVisible());
    expect(hasSay || hasReason).toBeTruthy();
  }).toPass({ timeout: 120000 });
}
