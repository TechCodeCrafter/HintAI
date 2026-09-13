import { expect, test } from "@playwright/test";

import {
  clickListen,
  NOISE_HALLUCINATION,
  openAudioCockpit,
  readDroppedUtterances,
  readFlightRecords,
  readThemTranscriptLines,
  waitForAnswerOutcome,
  waitForAsrWarmup,
  waitForRetryTranscript,
} from "./fixtures/audio-path";

test.describe("real audio path", () => {
  test("spoken question flows through VAD, gate, and answer", async ({ page }) => {
    test.setTimeout(180000);

    await openAudioCockpit(page);
    await waitForAsrWarmup(page);
    await clickListen(page);

    await waitForRetryTranscript(page);

    await waitForAnswerOutcome(page);

    const cardSay = page.getByTestId("card-say");
    const cardReason = page.getByTestId("card-reason");
    const spoke = (await cardSay.count()) > 0 && (await cardSay.isVisible());
    if (spoke) {
      await expect(cardSay).toContainText(/three|retry/i);
    } else {
      await expect(cardReason).not.toBeEmpty();
    }

    let records = await readFlightRecords(page);
    await expect(async () => {
      records = await readFlightRecords(page);
      expect(records.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000 });
    const last = records.at(-1)!;
    expect(last.kind).toBe("answer");
    expect(["grounded", "synthesis", "localCard", "silent"]).toContain(last.tier);
    expect(last.latency.retrieveMs).toBeGreaterThanOrEqual(0);
    expect(last.latency.totalMs).toBeGreaterThan(0);
    expect(last.query.toLowerCase()).toMatch(/re.?try|three times/);
  });

  test("silence must not trigger a card or flight answer record", async ({ page }) => {
    test.setTimeout(180000);

    await openAudioCockpit(page);
    await waitForAsrWarmup(page);
    await clickListen(page);

    await page.waitForTimeout(15000);

    await expect(page.getByTestId("card-say")).toHaveCount(0);

    const roomText = await page.getByTestId("room-turn").allInnerTexts();
    expect(roomText.join(" ").toLowerCase()).not.toMatch(/retry three times/);

    const records = await readFlightRecords(page);
    expect(records.filter((row) => row.kind === "answer")).toHaveLength(0);
  });

  test("noise must not trigger cards, hallucinations, or ungated utterances", async ({ page }) => {
    test.setTimeout(180000);

    await openAudioCockpit(page);
    await waitForAsrWarmup(page);
    await clickListen(page);

    await page.waitForTimeout(15000);

    await expect(page.getByTestId("card-say")).toHaveCount(0);
    expect((await readFlightRecords(page)).filter((row) => row.kind === "answer")).toHaveLength(0);

    const themLines = await readThemTranscriptLines(page);
    for (const line of themLines) {
      expect(line).not.toMatch(NOISE_HALLUCINATION);
    }
    expect(themLines).toHaveLength(0);

    expect(await readDroppedUtterances(page)).toBeGreaterThan(0);
  });
});
