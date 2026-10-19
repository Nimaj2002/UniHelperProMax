import { type RefObject, useEffect, useState } from "react";

/**
 * True once the element is within about one screen of the note's visible area (FR-024).
 * Stays true afterwards, so a drawn item isn't thrown away while scrolling.
 */
export function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const root = el.closest<HTMLElement>("[data-note-editor]");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { root, rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, near]);
  return near;
}
