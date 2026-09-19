/** Browser / device capability probes for Live audio and captions. */

export function isBrave(): boolean {
  if (typeof navigator === "undefined") return false;
  return Boolean((navigator as Navigator & { brave?: unknown }).brave);
}

/** iPhone, iPad, iPod — includes iPadOS desktop UA (MacIntel + touch). */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
}

export function isMobileTouch(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIOS() || /Android/.test(navigator.userAgent);
}

/** Tab audio share is reliable on desktop Chrome/Edge; mobile/tablet is mic-first. */
export function tabAudioShareLikely(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isMobileTouch()) return false;
  const ua = navigator.userAgent;
  return /Chrome|Chromium|Edg\//.test(ua) && !/OPR|Opera/.test(ua) && !isBrave();
}

/** Whisper ASR timeout — mobile CPUs need more headroom. */
export function asrFinalTimeoutMs(): number {
  return isMobileTouch() ? 14_000 : 9000;
}

export function asrPreviewTimeoutMs(): number {
  return isMobileTouch() ? 10_000 : 7000;
}
