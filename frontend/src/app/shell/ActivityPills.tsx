import { useLayoutEffect, useRef } from "react";
import { useActivities } from "./registry";

/**
 * Long-running work (recording, transcription) as compact pills floating at the bottom centre
 * of the main card on every page (008 FR-023). They take no layout space; the stack's height is
 * published as `--pills-h` so scroll areas can leave room for it. The width keeps clear of the
 * note's save chip in the bottom-right corner.
 */
export function ActivityPills() {
  const activities = useActivities();
  const stack = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = stack.current;
    const host = el?.parentElement;
    if (!el || !host || typeof ResizeObserver === "undefined") return;
    const publish = () => host.style.setProperty("--pills-h", el.offsetHeight ? `${el.offsetHeight + 12}px` : "0px");
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      host.style.removeProperty("--pills-h");
    };
  }, []);
  return (
    <div
      ref={stack}
      role="region"
      aria-label="Activity"
      className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex w-max max-w-[calc(100%-16rem)] -translate-x-1/2 flex-col items-center gap-2 empty:hidden"
    >
      {activities.map(({ id, component: C }) => (
        <C key={id} />
      ))}
    </div>
  );
}
