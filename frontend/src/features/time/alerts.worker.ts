/// <reference lib="webworker" />
/**
 * One timeout at the planned end of a Pomodoro phase or Focus session (020 research R4). Worker
 * timers aren't throttled like a hidden page's, so the alert arrives on time in the background.
 */
let id: ReturnType<typeof setTimeout> | undefined;

self.onmessage = (e: MessageEvent<{ at: number | null; key: string }>) => {
  clearTimeout(id);
  const { at, key } = e.data;
  if (at === null) return;
  id = setTimeout(() => self.postMessage(key), Math.max(0, at - Date.now()));
};
