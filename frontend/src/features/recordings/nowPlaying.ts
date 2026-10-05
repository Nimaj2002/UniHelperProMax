/** Only one recording plays at a time, app-wide (FR-019). */
let current: HTMLMediaElement | null = null;

export function claimPlayback(el: HTMLMediaElement) {
  if (current && current !== el && !current.paused) current.pause();
  current = el;
}

export function releasePlayback(el: HTMLMediaElement) {
  if (current === el) current = null;
}
