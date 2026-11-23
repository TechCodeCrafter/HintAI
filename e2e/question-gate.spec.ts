import { expect, test, type Page } from "@playwright/test";
import { openCockpit } from "./fixtures/helpers";

type Rejected = { candidate: string; verdict: string; reason: string | null; speechMs?: number; triggered: boolean };

/** A line as the listening path hands it to the store: the words and the speech behind them. */
function hear(page: Page, id: string, text: string, speechMs: number) {
  return page.evaluate(
    (event) => {
      const store = window.useMeetHint?.getState() as unknown as {
        heard: (event: { id: string; role: "them"; text: string; speechMs: number }) => void;
      };
      store.heard({ ...event, role: "them" });
    },
    { id, text, speechMs },
  );
}

function session(page: Page) {
  return page.evaluate(() => {
    const state = window.useMeetHint?.getState() as unknown as {
      card: { say?: string; query?: string } | null;
      searching: boolean;
      heardQuestion: string | null;
    };
    return {
      say: state.card?.say ?? null,
      query: state.card?.query ?? null,
      searching: state.searching,
      heardQuestion: state.heardQuestion,
      rejected: (window.__groundGate?.rejected() ?? []).map(
        (item): Rejected => ({
          candidate: item.candidate,
          verdict: item.verdict,
          reason: item.reason,
          speechMs: item.speechMs,
          triggered: item.triggered,
        }),
      ),
      decided: (window.__groundGate?.records() ?? []).length,
    };
  });
}

test("a line that is too short, a statement, or chatter starts no search and is logged with its reason", async ({ page }) => {
  await openCockpit(page);

  await hear(page, "g1", "why does the exporter retry three times", 400);
  await hear(page, "g2", "When we deployed the exporter it broke for a day", 3000);
  await hear(page, "g3", "Does that make sense?", 2000);
  // Long enough for a search to have started and answered, had one been fired.
  await page.waitForTimeout(1500);

  const after = await session(page);
  expect(after.say).toBeNull();
  expect(after.query).toBeNull();
  expect(after.searching).toBe(false);
  expect(after.heardQuestion).toBeNull();
  expect(after.decided).toBe(3);
  expect(after.rejected).toEqual([
    {
      candidate: "why does the exporter retry three times",
      verdict: "too-short",
      reason: "No question mark, and only 400 ms of speech (1200 ms needed).",
      speechMs: 400,
      triggered: false,
    },
    {
      candidate: "When we deployed the exporter it broke for a day",
      verdict: "not-a-question",
      reason: "Opens with a question word but is a statement.",
      speechMs: 3000,
      triggered: false,
    },
    {
      candidate: "Does that make sense?",
      verdict: "chatter",
      reason: "Talk about the meeting, not about the material.",
      speechMs: 2000,
      triggered: false,
    },
  ]);
});

test("the same words with 1.2 seconds of speech behind them are searched, and so is a short line that ends in a question mark", async ({ page }) => {
  await openCockpit(page);

  await hear(page, "s1", "why does the exporter retry three times", 1199);
  await page.waitForTimeout(800);
  expect((await session(page)).say).toBeNull();

  await hear(page, "s2", "why does the exporter retry three times", 1200);
  await expect(page.getByTestId("card").getByTestId("card-say")).not.toBeEmpty({ timeout: 15000 });
  const spoken = await session(page);
  expect(spoken.heardQuestion?.toLowerCase()).toContain("exporter retry three times");
  expect(spoken.rejected.map((item) => item.verdict)).toEqual(["too-short"]);

  // An explicit question mark does not wait for the speech to be long.
  await page.evaluate(() => (window.useMeetHint?.getState() as unknown as { clearThem: () => void }).clearThem());
  await hear(page, "s3", "Where is the session cookie set?", 300);
  await expect
    .poll(async () => (await session(page)).heardQuestion, { timeout: 15000 })
    .toBe("Where is the session cookie set?");
  expect((await session(page)).rejected.map((item) => item.verdict)).toEqual(["too-short"]);
});
