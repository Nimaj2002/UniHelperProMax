/**
 * 023: the running tour. Holds the step, the context the user built (course, session), waits
 * for real actions, navigates, persists status/chapter, and hands the overlay what to draw.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useLayout } from "@/app/shell/layout";
import { useModels } from "@/features/chat/models";
import { useUpdatePreferences } from "@/features/sessions/api";
import { tourEvents } from "./events";
import { findTarget } from "./targets";
import type { TourRequest } from "./store";
import { afterSkipping, firstStepOf, SESSION_ROUTE, stepIndex, STEPS, type ChapterId, type Step, type TourContext } from "./steps";
import { TourOverlay, type TourPhase } from "./TourOverlay";

const SEARCH_MS = 3000;
const SUCCESS_MS = 2200;

/** What Yuii says while the panel a step needs is closed: open it first, then she continues. */
const OPEN_PANEL: Record<NonNullable<Step["panel"]>, Pick<Step, "title" | "text" | "target">> = {
  left: {
    title: "Open the side panel",
    text: "Your side panel is tucked away. Click the button I'm pointing at to open it, then I'll show you around inside!",
    target: "open-left",
  },
  right: {
    title: "Open the right panel",
    text: "The right panel is closed right now. Click here to open it~",
    target: "open-right",
  },
  "home-right": {
    title: "Open the right panel",
    text: "Your right panel is folded away. Click here to open it and meet its little helpers!",
    target: "open-home-right",
  },
};
const NO_STEP: Step = { id: "", chapter: "welcome", kind: "show", title: "", text: "", expression: "instructional" };

/** The home page's right panel is open (it has width; closed it is only a rail). */
function useHomeRightOpen(enabled: boolean) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    const check = () => setOpen(((document.querySelector('[data-panel="tasks"]')?.getBoundingClientRect().width ?? 0) > 0));
    const t = window.setInterval(check, 250);
    const first = window.setTimeout(check, 0);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(first);
    };
  }, [enabled]);
  return open;
}

/** A dialog, menu or list of the app (not the tour's own UI) is open: the tour goes passive (research R5). */
function useForeignDialog(): Element | null {
  const [el, setEl] = useState<Element | null>(null);
  useEffect(() => {
    const check = () => {
      // dialogs, and menus / dropdown lists too: the bubble must never cover their items
      const found = [
        ...document.querySelectorAll(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"]',
        ),
      ].find(
        (d) => !d.closest("[data-tour-layer]"),
      );
      setEl((prev) => (prev === (found ?? null) ? prev : (found ?? null)));
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    return () => mo.disconnect();
  }, []);
  return el;
}

/** The step's target element and its rect, re-measured while the step is shown. */
function useTarget(step: Step) {
  // results are tagged with the step they belong to, so a new step starts clean without a reset
  const [state, setState] = useState<{
    step: Step;
    el: Element | null;
    rect: DOMRect | null;
    filled: boolean;
    appeared: boolean;
    gaveUp: boolean;
  } | null>(null);
  useEffect(() => {
    if (!step.target) return;
    const id = step.target;
    const started = Date.now();
    let scrolled = false;
    const revealed = new Set<string>();
    const w = step.waitFor;
    const tick = () => {
      // uncover the target once (expand a section, pick a panel tab)
      for (const sel of step.reveal ?? []) {
        if (revealed.has(sel)) continue;
        const r = document.querySelector<HTMLElement>(sel);
        if (r) {
          revealed.add(sel);
          r.click();
        }
      }
      const appeared = !!w && "appears" in w && !!findTarget(w.appears);
      const el = findTarget(id);
      if (!el) {
        const gaveUp = Date.now() - started > SEARCH_MS;
        setState((prev) =>
          prev?.step === step && !prev.el && prev.gaveUp === gaveUp && prev.appeared === appeared
            ? prev
            : { step, el: null, rect: null, filled: false, appeared, gaveUp },
        );
        return;
      }
      if (!scrolled) {
        scrolled = true;
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      const rect = el.getBoundingClientRect();
      const filled = el.getAttribute("data-filled") === "true";
      setState((prev) =>
        prev?.step === step && prev.el === el && prev.filled === filled && prev.appeared === appeared && prev.rect && sameRect(prev.rect, rect)
          ? prev
          : { step, el, rect, filled, appeared, gaveUp: false },
      );
    };
    const first = window.setTimeout(tick, 0);
    const t = window.setInterval(tick, 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [step]);
  const mine = state?.step === step ? state : null;
  const found = mine?.el && mine.rect ? { el: mine.el, rect: mine.rect, filled: mine.filled } : null;
  return { found, appeared: !!mine?.appeared, searching: !!step.target && !found && !mine?.gaveUp };
}

const sameRect = (a: DOMRect, b: DOMRect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export function TourRunner({ request, onClose }: { request: TourRequest; onClose: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const updatePrefs = useUpdatePreferences();
  const models = useModels();
  const [index, setIndex] = useState(() => Math.max(0, firstStepOf(request.chapter)));
  const [ctx, setCtx] = useState<TourContext>(() => (SESSION_ROUTE.test(pathname) ? { sessionPath: pathname } : {}));
  const [phase, setPhase] = useState<TourPhase>(request.resume ? "resume" : "run");
  const dialog = useForeignDialog();

  const context = useMemo<TourContext>(() => ({ ...ctx, aiConfigured: models.choices.length > 0 }), [ctx, models.choices.length]);
  const step = STEPS[index];
  const { found, appeared, searching } = useTarget(step);
  const missing = (step.requires ?? []).filter((k) => !context[k]);

  // the panel this step needs is closed: teach opening it first (shown instead of the step)
  const layout = useLayout();
  const homeRightOpen = useHomeRightOpen(step.panel === "home-right");
  const panelOpen =
    step.panel === "left" ? layout.leftVisible : step.panel === "right" ? layout.rightVisible : step.panel === "home-right" ? homeRightOpen : true;
  const gated = !!step.panel && !panelOpen && (!found || !!step.openFirst) && phase === "run" && missing.length === 0;
  const openStep = useMemo<Step | null>(
    () => (gated && step.panel ? { ...OPEN_PANEL[step.panel], id: `${step.id}#open`, chapter: step.chapter, kind: "do", expression: "instructional" } : null),
    [gated, step],
  );
  const opener = useTarget(openStep ?? NO_STEP);

  // ---- persistence (FR-019): written on start, chapter change, end and finish -------------
  const save = useCallback(
    (status: "in_progress" | "skipped" | "completed", chapter: ChapterId | null) =>
      updatePrefs.mutate({ tour: { status, chapter } }),
    [updatePrefs],
  );
  const savedChapter = useRef<ChapterId | null>(null);
  useEffect(() => {
    if (phase === "resume" || savedChapter.current === step.chapter) return;
    savedChapter.current = step.chapter;
    save("in_progress", step.chapter);
  }, [phase, step.chapter, save]);

  // the session the user opened (or is in) feeds the later chapters (state adjusted while rendering)
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (SESSION_ROUTE.test(pathname)) setCtx((c) => ({ ...c, sessionPath: pathname }));
  }

  // ---- moving between steps ---------------------------------------------------------------
  const go = useCallback(
    (to: number, dir: 1 | -1 = 1) => {
      let i = to;
      while (i >= 0 && i < STEPS.length && STEPS[i].skipIf?.(context)) i += dir;
      if (i >= STEPS.length) {
        save("completed", null);
        onClose();
        return;
      }
      setIndex(Math.max(0, i));
      setPhase("run");
    },
    [context, save, onClose],
  );
  const next = useCallback(() => go(index + 1), [go, index]);
  const back = useCallback(() => go(index - 1, -1), [go, index]);
  const end = useCallback(() => {
    save("skipped", null);
    onClose();
  }, [save, onClose]);
  const finish = useCallback(() => {
    save("completed", null);
    onClose();
  }, [save, onClose]);

  // navigate once when a step starts; never fight the user afterwards
  const routedFor = useRef(-1);
  useEffect(() => {
    if (phase !== "run" || routedFor.current === index) return;
    routedFor.current = index;
    const route = typeof step.route === "function" ? step.route(context) : step.route;
    if (route && route !== pathname) navigate(route);
  }, [phase, index, step, context, pathname, navigate]);

  const succeed = useCallback(() => {
    if (step.successText) setPhase("success");
    else next();
  }, [step.successText, next]);

  // success text is shown briefly, then the tour moves on by itself
  useEffect(() => {
    if (phase !== "success") return;
    const t = window.setTimeout(next, SUCCESS_MS);
    return () => window.clearTimeout(t);
  }, [phase, next]);

  // ---- waiting for the user's action (do steps) -------------------------------------------
  useEffect(() => {
    if (step.kind !== "do" || (phase !== "run" && phase !== "error")) return;
    const offFail = tourEvents.on("action.failed", () => setPhase("error"));
    const w = step.waitFor;
    let offDone = () => {};
    if (w && "event" in w) {
      offDone = tourEvents.on(w.event, (payload: unknown) => {
        const p = payload as { courseId?: string } | undefined;
        if (p?.courseId) setCtx((c) => ({ ...c, courseId: p.courseId }));
        succeed();
      });
    }
    // the form was saved while Yuii was still on one of its fields: jump to the celebration
    const doneAt = step.dialog?.doneAt;
    const offSaved =
      doneAt && !(w && "event" in w && w.event === "class.created")
        ? tourEvents.on("class.created", ({ courseId }) => {
            setCtx((c) => ({ ...c, courseId }));
            go(stepIndex(doneAt));
          })
        : () => {};
    return () => {
      offFail();
      offDone();
      offSaved();
    };
  }, [step, phase, succeed, go]);

  // route and filled waits are checked as the location / target change; advancing is deferred a tick
  const w = step.waitFor;
  const reached =
    step.kind === "do" &&
    phase === "run" &&
    !!w &&
    (("route" in w && w.route.test(pathname)) || ("filled" in w && !!found?.filled) || ("appears" in w && appeared));
  // a preselected field still gets a few seconds on screen so its explanation can be read;
  // one the user fills during the step moves on at once
  const stepStartedAt = useRef(0);
  useEffect(() => {
    stepStartedAt.current = Date.now(); // runs before the effects below when the step changes
  }, [index]);
  // was the field already filled when Yuii first saw it (preselected), or did the user fill it?
  const prefilled = useRef<{ index: number; value: boolean } | null>(null);
  useEffect(() => {
    if (found && prefilled.current?.index !== index) prefilled.current = { index, value: found.filled };
  }, [found, index]);
  // the latest `succeed`; it changes identity on most renders, which must not restart the timer
  const succeedRef = useRef(succeed);
  useEffect(() => {
    succeedRef.current = succeed;
  });
  useEffect(() => {
    if (!reached) return;
    const dwell = prefilled.current?.index === index && prefilled.current.value ? (step.minDwellMs ?? 0) : 0;
    const wait = Math.max(0, dwell - (Date.now() - stepStartedAt.current));
    const t = window.setTimeout(() => succeedRef.current(), wait);
    return () => window.clearTimeout(t);
  }, [reached, step.minDwellMs, index]);

  // fields that only exist sometimes (a new semester's dates): no target, no step
  useEffect(() => {
    if (!step.skipIfMissing || !step.target || phase !== "run") return;
    const id = step.target;
    const t = window.setTimeout(() => {
      if (!findTarget(id)) next();
    }, 700);
    return () => window.clearTimeout(t);
  }, [step, phase, next]);

  // a dialog-bound step whose dialog was closed (cancelled) starts that part again
  useEffect(() => {
    if (!step.dialog || dialog) return;
    const t = window.setTimeout(() => go(stepIndex(step.dialog!.restartAt)), 500);
    return () => window.clearTimeout(t);
  }, [step, dialog, go]);

  return (
    <TourOverlay
      step={openStep ?? step}
      index={index}
      total={STEPS.length}
      phase={phase}
      context={context}
      firstRun={!!request.firstRun}
      resumeChapter={request.chapter}
      passive={!!dialog}
      avoid={dialog ? dialog.getBoundingClientRect() : null}
      target={(openStep ? opener.found?.rect : found?.rect) ?? null}
      searching={openStep ? opener.searching : searching}
      missing={missing.length > 0}
      onNext={!openStep && (step.kind === "show" || phase === "success") ? next : undefined}
      onBack={index > 0 ? back : undefined}
      onSkip={openStep || step.optional || missing.length > 0 || phase === "error" ? () => go(afterSkipping(index)) : undefined}
      onEnd={() => setPhase("confirm-end")}
      onConfirmEnd={end}
      onCancelEnd={() => setPhase("run")}
      onFinish={finish}
      onResume={() => setPhase("run")}
      onLater={end}
    />
  );
}
