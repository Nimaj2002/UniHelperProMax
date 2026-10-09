/**
 * Reading position (007 FR-019, research R12): the reader opens at the user's last page
 * (`min(page, numPages)`) once its pages are laid out and shown, and saves the page while the
 * user reads (1 s after it settles) and when the tab closes or the browser leaves.
 */
import { useEffect, useRef, useState } from "react";
import { fetchPosition, savePosition } from "../api";

const SAVE_DELAY = 1000;

interface Options {
  documentId: string;
  /** Pages laid out and the reader shown in a pane. */
  active: boolean;
  page: number;
  pageCount: number;
  goTo: (page: number) => void;
}

export function usePosition({ documentId, active, page, pageCount, goTo }: Options) {
  // undefined while loading; null when never opened (or unknown: open at page 1)
  const [remembered, setRemembered] = useState<number | null | undefined>(undefined);
  const restored = useRef(false);
  const lastSaved = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const goToRef = useRef(goTo);
  useEffect(() => {
    goToRef.current = goTo;
  });

  useEffect(() => {
    let live = true;
    fetchPosition(documentId).then(
      (p) => live && setRemembered(p.page),
      () => live && setRemembered(null),
    );
    return () => {
      live = false;
    };
  }, [documentId]);

  // open at the remembered page, once
  useEffect(() => {
    if (restored.current || !active || remembered === undefined || pageCount < 1) return;
    restored.current = true;
    lastSaved.current = remembered;
    if (remembered && remembered > 1) goToRef.current(Math.min(remembered, pageCount));
  }, [active, remembered, pageCount]);

  // save while reading
  useEffect(() => {
    if (!restored.current || page === lastSaved.current) return;
    pending.current = page;
    const t = window.setTimeout(() => {
      const p = pending.current;
      pending.current = null;
      if (p === null) return;
      lastSaved.current = p;
      void savePosition(documentId, p).catch(() => {});
    }, SAVE_DELAY);
    return () => window.clearTimeout(t);
  }, [documentId, page]);

  // tab closed or browser leaving: send what's pending
  useEffect(() => {
    const flush = () => {
      const p = pending.current;
      pending.current = null;
      if (p !== null && p !== lastSaved.current) {
        lastSaved.current = p;
        void savePosition(documentId, p, true).catch(() => {});
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [documentId]);
}
