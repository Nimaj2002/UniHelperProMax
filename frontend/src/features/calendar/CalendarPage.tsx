import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router";
import { Card } from "@/app/shell/Card";
import { useMe } from "@/features/auth/api";
import { useSessions } from "@/features/classes/api";
import { useShowTasks } from "@/features/tasks/calendar/showTasks";
import { useCalendarTasks } from "@/features/tasks/calendar/useCalendarTasks";
import { monthRange, todayISO, weekRange } from "@/lib/dates";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { CalendarToolbar } from "./CalendarToolbar";
import { DayView } from "./DayView";
import { announcement, MONTH_DRAFT } from "./draft";
import { EntryGuardProvider, focusQuickForm } from "./entryGuard";
import { MonthView } from "./MonthView";
import { QuickCreate } from "./QuickCreateForm";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { lastCalendar, rememberCalendar, VIEWS, type CalendarView } from "./state";
import { useCalendarKeyboard } from "./useCalendarKeyboard";
import { useDraft, type DraftControls } from "./useDraft";
import { WeekView } from "./WeekView";

function isView(v: string | undefined): v is CalendarView {
  return !!v && (VIEWS as string[]).includes(v);
}

function rangeFor(view: CalendarView, date: string) {
  if (view === "day") return { from: date, to: date };
  if (view === "week") return weekRange(date);
  return monthRange(date);
}

interface Props {
  /** Inside the home page's Calendar panel (012): the panel is the landmark; one 40 px header row. */
  compact?: boolean;
  /** Controls at the start / end of the compact header (left-card opener, panel close button). */
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function CalendarPage({ compact = false, leading, trailing }: Props = {}) {
  const params = useParams();
  const { data: me } = useMe();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  const tz = me?.timezone ?? "UTC";
  const last = lastCalendar();
  const view: CalendarView = isView(params.view) ? params.view : (last.view ?? (isDesktop ? "week" : "day"));
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : (last.date ?? todayISO(tz));
  rememberCalendar(view, date);

  const range = rangeFor(view, date);
  const sessions = useSessions(range.from, range.to);
  // 012 US6: tasks on the calendar, inside the home page's panel ("Show tasks")
  const [showTasks] = useShowTasks();
  const tasks = useCalendarTasks(compact && showTasks, range.from, range.to, tz);
  const [help, setHelp] = useState(false);
  const openHelp = useCallback(() => setHelp(true), []);
  useCalendarKeyboard(view, date, tz, openHelp);

  const drafts = useDraft();
  useDraftLifecycle(drafts, range);
  const message = useDraftAnnouncement(drafts);
  const blocked = useFilledFormGuard(drafts);

  const list = sessions.data ?? [];
  return (
    <EntryGuardProvider blocked={blocked}>
      {/* inside the home page the panel is the "Calendar" landmark (an unnamed section is none) */}
      <section aria-label={compact ? undefined : "Calendar"} className={compact ? "flex h-full min-h-0 flex-col gap-2" : "flex h-full min-h-0 flex-col"} aria-busy={sessions.isFetching}>
        {compact ? (
          // home page: the header bar is its own card, like Settings' credit bar
          <Card className="shrink-0" body="fill">
            <CalendarToolbar view={view} date={date} tz={tz} compact leading={leading} trailing={trailing} />
          </Card>
        ) : (
          <CalendarToolbar view={view} date={date} tz={tz} />
        )}
        <Body card={compact}>
          {sessions.isError && (
            <p role="alert" className="border-b border-divider px-4 py-2 text-sm text-danger">
              Couldn't load sessions. Check your connection; the calendar retries automatically.
            </p>
          )}
          <motion.div
            key={`${view}:${range.from}`}
            className="flex min-h-0 flex-1 flex-col"
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            {view === "day" && <DayView date={date} sessions={list} tz={tz} drafts={drafts} tasks={tasks} />}
            {view === "week" && <WeekView date={date} sessions={list} tz={tz} drafts={drafts} tasks={tasks} />}
            {view === "month" && (
              <MonthView
                date={date}
                sessions={list}
                tz={tz}
                tasks={tasks}
                draft={drafts.state.draft}
                onCreateDraft={(d) => drafts.start(d, MONTH_DRAFT, "month", "open")}
              />
            )}
          </motion.div>
          <QuickCreate drafts={drafts} />
        </Body>
        {/* 009 FR-043: drafts are announced, not their aria-hidden blocks */}
        <div role="status" aria-live="polite" className="sr-only" data-testid="draft-announcer">
          {message}
        </div>
        <ShortcutsDialog open={help} onOpenChange={setHelp} />
      </section>
    </EntryGuardProvider>
  );
}

/** The calendar under the header: its own card on the home page, inline on the full page. */
function Body({ card, children }: { card: boolean; children: ReactNode }) {
  return card ? (
    <Card className="flex-1" body="fill">
      {children}
    </Card>
  ) : (
    <>{children}</>
  );
}

/** A filled quick form blocks clicks that would open an entry or another day: they would leave
 * the calendar and lose what was entered (009 FR-039). Focus goes back to the form instead. */
function useFilledFormGuard(drafts: DraftControls): () => boolean {
  const latest = useRef(drafts.state);
  useEffect(() => {
    latest.current = drafts.state;
  });
  return useCallback(() => {
    const { draft, phase, dirty } = latest.current;
    const filled = !!draft && phase === "open" && dirty;
    if (filled) focusQuickForm();
    return filled;
  }, []);
}

/** Leaving the page (or showing a period without the draft's day) discards an unsaved draft;
 * one with something entered survives a view change that still shows its day (009 FR-039). */
function useDraftLifecycle(drafts: DraftControls, range: { from: string; to: string }) {
  const { pathname } = useLocation();
  const { draft, dirty } = drafts.state;
  const { discard } = drafts;
  const first = useRef(true);
  const latest = useRef({ draft, dirty, range });
  useEffect(() => {
    latest.current = { draft, dirty, range };
  });
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const { draft, dirty, range } = latest.current;
    if (!draft) return;
    const shown = (pathname === "/" || pathname.startsWith("/calendar")) && draft.date >= range.from && draft.date <= range.to;
    if (!(dirty && shown)) discard(draft.id);
  }, [pathname, discard]);
}

/** "New entry, from 13:00 to 14:45" on creation and every change; while dragging only after
 * the pointer rests for 300 ms (009 FR-043, research R12). */
function useDraftAnnouncement(drafts: DraftControls): string {
  const { draft, phase } = drafts.state;
  const [message, setMessage] = useState("");
  const text = draft ? announcement(draft) : "";
  useEffect(() => {
    if (!text) return;
    const id = window.setTimeout(() => setMessage(text), phase === "drag" ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [text, phase]);
  return draft ? message : "";
}
