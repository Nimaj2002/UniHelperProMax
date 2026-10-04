import { motion, useReducedMotion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router";
import { usePageToolbar } from "@/app/shell/toolbar";
import { useMe } from "@/features/auth/api";
import { useSessions } from "@/features/classes/api";
import { monthRange, todayISO, weekRange } from "@/lib/dates";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { CalendarToolbar } from "./CalendarToolbar";
import { DayView } from "./DayView";
import { MonthView } from "./MonthView";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { lastCalendar, rememberCalendar, VIEWS, type CalendarView } from "./state";
import { useCalendarKeyboard } from "./useCalendarKeyboard";
import { WeekView } from "./WeekView";

function isView(v: string | undefined): v is CalendarView {
  return !!v && (VIEWS as string[]).includes(v);
}

function rangeFor(view: CalendarView, date: string) {
  if (view === "day") return { from: date, to: date };
  if (view === "week") return weekRange(date);
  return monthRange(date);
}

export function CalendarPage() {
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
  const [help, setHelp] = useState(false);
  const openHelp = useCallback(() => setHelp(true), []);
  useCalendarKeyboard(view, date, tz, openHelp);

  const toolbar = useMemo(() => <CalendarToolbar view={view} date={date} tz={tz} />, [view, date, tz]);
  usePageToolbar(toolbar);

  const list = sessions.data ?? [];
  return (
    <section aria-label="Calendar" className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col" aria-busy={sessions.isFetching}>
      {sessions.isError && (
        <p role="alert" className="border-b border-divider px-4 py-2 text-sm text-danger">
          Couldn't load sessions. Check your connection; the calendar retries automatically.
        </p>
      )}
      <motion.div
        key={`${view}:${range.from}`}
        className="flex min-h-0 flex-1 flex-col"
        initial={reduceMotion ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        {view === "day" && <DayView date={date} sessions={list} tz={tz} />}
        {view === "week" && <WeekView date={date} sessions={list} tz={tz} />}
        {view === "month" && <MonthView date={date} sessions={list} tz={tz} />}
      </motion.div>
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
    </section>
  );
}
