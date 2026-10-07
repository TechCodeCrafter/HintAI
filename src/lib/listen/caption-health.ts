/**
 * Tracks consecutive SpeechRecognition "network" errors for the mic caption
 * lane. A blip or two stays silent (onend backs off and restarts), but a
 * persistently failing lane is declared dead so the UI can say so instead of
 * greeting "Hearing you" forever.
 */
const NETWORK_ERROR_LIMIT = 5;

export class CaptionHealth {
  private consecutiveNetworkErrors = 0;

  /** Returns true the moment the lane crosses from flaky to dead (fires once). */
  noteNetworkError(): boolean {
    this.consecutiveNetworkErrors += 1;
    return this.consecutiveNetworkErrors === NETWORK_ERROR_LIMIT;
  }

  /** Any caption result proves the service is reachable again. */
  noteHeard(): void {
    this.consecutiveNetworkErrors = 0;
  }

  reset(): void {
    this.consecutiveNetworkErrors = 0;
  }

  get dead(): boolean {
    return this.consecutiveNetworkErrors >= NETWORK_ERROR_LIMIT;
  }
}
