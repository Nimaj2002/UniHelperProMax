/**
 * 023: what the tour draws above the app: a dimmed backdrop with a hole around the target,
 * Yuii beside it (pointing pose, mirrored for right-facing) and her speech bubble.
 * Passive while an app dialog is open (research R5): no backdrop, no controls, live text only.
 */
import { motion } from "motion/react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BUBBLE_H, PAD, place, type Rect } from "./placement";
import { chapterName, CHAPTERS, textOf, type ChapterId, type Expression, type Step, type TourContext } from "./steps";

export type TourPhase = "run" | "success" | "error" | "confirm-end" | "resume";

const ART = import.meta.glob("./assets/*.{png,webp}", { eager: true, import: "default" }) as Record<string, string>;
const art = (name: string) => ART[`./assets/${name}.png`] ?? ART[`./assets/${name}.webp`];
const EXPRESSION_FILE: Record<Expression, string> = {
  greeting: "greeting",
  instructional: "instructional",
  excited: "excited",
  thinking: "thinking",
  shy: "shy",
  dizzy: "dizzy",
  tablet: "tablet",
  wink: "finger-heart-wink",
};

function useViewport() {
  const read = () => `${window.innerWidth}x${window.innerHeight}`;
  const key = useSyncExternalStore(
    (f) => (window.addEventListener("resize", f), () => window.removeEventListener("resize", f)),
    read,
    read,
  );
  const [w, h] = key.split("x").map(Number);
  return { w, h };
}

export interface TourOverlayProps {
  step: Step;
  index: number;
  total: number;
  phase: TourPhase;
  context: TourContext;
  firstRun: boolean;
  resumeChapter: ChapterId;
  passive: boolean;
  /** An open dialog to stand beside instead of the target (dialog-bound steps). */
  avoid: Rect | null;
  target: Rect | null;
  searching: boolean;
  missing: boolean;
  onNext?: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  onEnd: () => void;
  onConfirmEnd: () => void;
  onCancelEnd: () => void;
  onFinish: () => void;
  onResume: () => void;
  onLater: () => void;
}

export function TourOverlay(p: TourOverlayProps) {
  const vp = useViewport();
  const titleId = useId();
  const textId = useId();
  const bubbleRef = useRef<HTMLDivElement>(null);
  const { step, phase } = p;
  const isLast = p.index === p.total - 1;
  const welcome = p.index === 0 && phase === "run";
  // an app dialog opened over the target (e.g. New note's name box): stand beside it, stop pointing
  const covered = p.passive && !step.dialog;
  const pointAt = p.avoid ?? p.target;
  const placement = place(phase === "resume" ? null : pointAt, vp);

  // ---- what Yuii says and looks like --------------------------------------------------------
  let title = step.title;
  let text = textOf(step.text, p.context);
  let expression: Expression | null = step.expression;
  if (phase === "resume") {
    title = "Welcome back!";
    text = `We stopped at “${chapterName(p.resumeChapter)}”. Shall we carry on from there?`;
    expression = "greeting";
  } else if (phase === "confirm-end") {
    title = "Leaving already?";
    text = "You can replay me any time from the Yuii button or Settings → Account.";
    expression = "shy";
  } else if (phase === "success") {
    text = step.successText ?? text;
    expression = "excited";
  } else if (phase === "error") {
    text = step.errorText ?? "Hmm, that didn't work. Try again, or skip this one!";
    expression = step.errorExpression ?? "dizzy";
  } else if (p.missing) {
    title = "We need a class session first";
    text = "This part happens inside a class session. Open one from the calendar (or go back and make a course) and I'll continue right there!";
    expression = "thinking";
  } else if (covered) {
    text = step.dialogText ?? "Go ahead, I'll wait right here~";
    expression = "excited";
  } else if (p.target && placement.mode !== "center") {
    expression = null; // pointing pose
  }
  const image =
    expression === null
      ? { src: art(placement.pose), alt: "Yuii, pointing", mirrored: placement.mirrored }
      : { src: art(EXPRESSION_FILE[expression]), alt: `Yuii, ${expression}`, mirrored: false };

  // ---- focus and keys (interactive only) --------------------------------------------------
  useEffect(() => {
    if (p.passive) return;
    // never pull focus out of what the user is typing in (a step may finish mid-typing)
    const active = document.activeElement as HTMLElement | null;
    if (active && !active.closest("[data-tour-layer]") && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
    const el = bubbleRef.current;
    (el?.querySelector<HTMLElement>("[data-primary]") ?? el)?.focus({ preventScroll: true });
  }, [p.index, phase, p.passive, p.missing]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (phase === "confirm-end") p.onCancelEnd();
      else if (welcome) p.onLater();
      else p.onEnd();
    } else if (e.key === "ArrowRight" && phase === "run" && p.onNext && !welcome) {
      e.preventDefault();
      if (isLast) p.onFinish();
      else p.onNext();
    } else if (e.key === "ArrowLeft" && phase === "run" && p.onBack) {
      e.preventDefault();
      p.onBack();
    }
  };

  // ---- controls -----------------------------------------------------------------------------
  let buttons: ReactNode;
  if (phase === "resume") {
    buttons = (
      <>
        <Button size="sm" variant="ghost" onClick={p.onLater}>End tour</Button>
        <Button size="sm" data-primary onClick={p.onResume}>Continue</Button>
      </>
    );
  } else if (phase === "confirm-end") {
    buttons = (
      <>
        <Button size="sm" variant="ghost" onClick={p.onConfirmEnd}>Yes, end the tour</Button>
        <Button size="sm" data-primary onClick={p.onCancelEnd}>Keep going</Button>
      </>
    );
  } else if (welcome) {
    buttons = (
      <>
        <Button size="sm" variant="ghost" onClick={p.firstRun ? p.onLater : p.onEnd}>{p.firstRun ? "Maybe later" : "End tour"}</Button>
        <Button size="sm" data-primary onClick={p.onNext}>{p.firstRun ? "Start the tour" : "Let's go!"}</Button>
      </>
    );
  } else {
    const nextLabel = isLast ? "Finish" : "Next";
    buttons = (
      <>
        <Button size="sm" variant="ghost" onClick={p.onEnd}>End tour</Button>
        <span className="flex-1" />
        {p.onBack && phase !== "success" && <Button size="sm" variant="outline" onClick={p.onBack}>Back</Button>}
        {p.onSkip && phase !== "success" && (step.kind === "do" || p.missing) && (
          // not focused by default: a stray Space/Enter must not skip a hands-on step
          <Button size="sm" variant="secondary" onClick={p.onSkip}>Skip this step</Button>
        )}
        {p.onNext && !p.missing && (
          <Button size="sm" data-primary onClick={isLast ? p.onFinish : p.onNext}>{nextLabel}</Button>
        )}
      </>
    );
  }

  const chapterNo = CHAPTERS.findIndex((c) => c.id === step.chapter) + 1;
  const progress = `Step ${p.index + 1} of ${p.total} · ${chapterName(step.chapter)} (${chapterNo}/${CHAPTERS.length})`;
  const showYuii = placement.mode !== "bubble" && placement.height > 0;
  const hole = p.target && !p.passive ? p.target : null;
  const bubbleTop = placement.mode === "bubble" ? placement.bubble.y : placement.bubble.y + BUBBLE_H;

  return createPortal(
    <div data-tour-layer className="pointer-events-none fixed inset-0 z-[60]">
      {/* a hands-on step with nothing to point at, or a free choice, leaves the whole app usable */}
      {!p.passive && !(step.kind === "do" && (!hole || step.free) && phase === "run") && <Backdrop hole={hole} vp={vp} />}
      {p.target && !covered && phase !== "resume" && (
        <div
          aria-hidden
          className="absolute rounded-lg ring-2 ring-ring ring-offset-2 ring-offset-background transition-all"
          style={{ left: p.target.left - PAD / 2, top: p.target.top - PAD / 2, width: p.target.width + PAD, height: p.target.height + PAD }}
        />
      )}
      {showYuii && image.src && (
        <motion.div
          aria-hidden
          className="absolute left-0 top-0"
          initial={false}
          animate={{ x: placement.x, y: placement.y, width: placement.width, height: placement.height }}
        >
          <img
            key={image.src}
            src={image.src}
            alt=""
            draggable={false}
            className={cn(
              // the art is cropped at the waist: fade it out instead of a hard edge
              "size-full object-contain drop-shadow-lg animate-in fade-in-0 [mask-image:linear-gradient(to_bottom,black_78%,transparent)]",
              placement.side === "left" ? "object-right-bottom" : "object-left-bottom",
              image.mirrored && "-scale-x-100",
            )}
          />
        </motion.div>
      )}
      <motion.div
        ref={bubbleRef}
        role={p.passive ? undefined : "dialog"}
        aria-modal={p.passive ? undefined : false}
        aria-labelledby={p.passive ? undefined : titleId}
        aria-describedby={p.passive ? undefined : textId}
        tabIndex={p.passive ? undefined : -1}
        onKeyDown={p.passive ? undefined : onKeyDown}
        className={cn(
          "absolute left-0 top-0 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none",
          !p.passive && "pointer-events-auto",
          placement.mode !== "bubble" && "-translate-y-full",
        )}
        style={{ width: placement.bubble.width }}
        initial={false}
        animate={{ x: placement.bubble.x, y: bubbleTop }}
      >
        <div className="flex items-start gap-3">
          {!showYuii && image.src && (
            <img src={image.src} alt="" className={cn("size-12 shrink-0 object-contain", image.mirrored && "-scale-x-100")} />
          )}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{progress}</p>
            <h2 id={titleId} className="mt-1 font-semibold">{title}</h2>
            <p id={textId} className="mt-1 text-sm">{text}</p>
            <span className="sr-only">{image.alt}</span>
          </div>
        </div>
        {!p.passive && <div className="mt-3 flex flex-wrap items-center justify-end gap-2">{buttons}</div>}
        {p.searching && !p.passive && <p className="sr-only" role="status">Looking for it…</p>}
      </motion.div>
      {p.passive && (
        <div aria-live="polite" className="sr-only">
          {`Yuii: ${title}. ${text}`}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Dim everything except the hole; the hole lets clicks through to the real control. */
function Backdrop({ hole, vp }: { hole: Rect | null; vp: { w: number; h: number } }) {
  const [maskId] = useState(() => `tour-mask-${Math.random().toString(36).slice(2)}`);
  if (!hole) return <div className="pointer-events-auto absolute inset-0 bg-overlay" />;
  const l = hole.left - PAD;
  const t = hole.top - PAD;
  const r = hole.left + hole.width + PAD;
  const b = hole.top + hole.height + PAD;
  const block = "pointer-events-auto absolute";
  return (
    <>
      <svg aria-hidden className="absolute inset-0 size-full" width={vp.w} height={vp.h}>
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            <rect x={l} y={t} width={r - l} height={b - t} rx={10} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" className="fill-overlay" mask={`url(#${maskId})`} />
      </svg>
      <div className={block} style={{ left: 0, top: 0, width: vp.w, height: Math.max(0, t) }} />
      <div className={block} style={{ left: 0, top: b, width: vp.w, height: Math.max(0, vp.h - b) }} />
      <div className={block} style={{ left: 0, top: t, width: Math.max(0, l), height: b - t }} />
      <div className={block} style={{ left: r, top: t, width: Math.max(0, vp.w - r), height: b - t }} />
    </>
  );
}
