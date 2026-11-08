/** 023 research R13: starts the tour on first run (or offers to continue) and lazy-loads it. */
import { lazy, Suspense, useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { usePreferences } from "@/features/sessions/api";
import { closeTour, requestTour, useTourRequest } from "./store";

const TourRunner = lazy(() => import("./TourRunner").then((m) => ({ default: m.TourRunner })));

const NO_AUTO = ["/setup", "/login", "/account/password"];

/**
 * shortcut: browser automation (Playwright) does not get the auto-start, so existing e2e specs
 * are not covered by Yuii; a spec opts in with localStorage "uh.tour.e2e" = "1".
 */
function automated(): boolean {
  try {
    return navigator.webdriver && localStorage.getItem("uh.tour.e2e") !== "1";
  } catch {
    return navigator.webdriver;
  }
}

export function TourHost() {
  const prefs = usePreferences();
  const request = useTourRequest();
  const { pathname } = useLocation();
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current || !prefs.data || NO_AUTO.some((p) => pathname.startsWith(p))) return;
    decided.current = true;
    const tour = prefs.data.tour;
    if (!tour || automated()) return;
    if (tour.status === "not_seen") requestTour({ chapter: "welcome", firstRun: true });
    else if (tour.status === "in_progress" && tour.chapter) requestTour({ chapter: tour.chapter, resume: true });
  }, [prefs.data, pathname]);

  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <TourRunner key={request.n} request={request} onClose={closeTour} />
    </Suspense>
  );
}
