import type { Page } from "@playwright/test";

export async function installE2eMocks(page: Page) {
  await page.addInitScript(() => {
    window.__mockEmbedder = async (text: string) => {
      const vec = new Array(384).fill(0);
      for (let i = 0; i < text.length; i += 1) {
        vec[i % 384] = (text.charCodeAt(i) % 100) / 100;
      }
      return vec;
    };

    class FakeSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {}
      stop() {}
      abort() {}
    }

    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeSpeechRecognition,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: FakeSpeechRecognition,
    });
  });
}

export async function mockLLM(page: Page, response: string | null) {
  await page.evaluate((say) => {
    window.__mockCraftCard = async () => ({ say });
  }, response);
}

export async function injectUtterance(page: Page, text: string, speaker: "them" | "you" = "them") {
  await page.evaluate(
    ({ text, speaker }) => {
      const store = window.useGround?.getState?.();
      if (!store) throw new Error("Store not found on window");
      store.appendUtterance({
        at: Date.now(),
        speaker: speaker === "them" ? "Interviewer" : "You",
        role: speaker,
        text,
      });
      if (speaker === "them" && store.autoAnswer) {
        void store.search(text, { fast: true });
      }
    },
    { text, speaker },
  );
}
