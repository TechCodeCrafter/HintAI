/**
 * How long words kept arriving for one recognition result.
 *
 * Browser speech recognition reports no audio timing, so the speech behind a
 * result is measured from what it does report: the first interim transcript
 * for the result, and the last time that transcript changed. The quiet the
 * recognizer waits through before it calls a result final is not counted, so
 * this never reads longer than the speech was. It can read shorter, because
 * the first interim arrives after the first word has been recognized.
 */
export type SpeechSpans = {
  /** An interim transcript for the result with this key. */
  note: (key: string, text: string, at: number) => void;
  /** The result is final: its span in milliseconds, 0 when no interim was seen. */
  take: (key: string) => number;
  clear: () => void;
};

export function createSpeechSpans(): SpeechSpans {
  const open = new Map<string, { first: number; last: number; text: string }>();
  return {
    note(key, text, at) {
      const seen = open.get(key);
      if (!seen) {
        open.set(key, { first: at, last: at, text });
        return;
      }
      if (seen.text === text) return;
      seen.text = text;
      seen.last = at;
    },
    take(key) {
      const seen = open.get(key);
      open.delete(key);
      return seen ? Math.max(0, seen.last - seen.first) : 0;
    },
    clear() {
      open.clear();
    },
  };
}
