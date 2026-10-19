import type { Session } from "@/features/classes/api";
import type { CalendarTasks } from "@/features/tasks/calendar/useCalendarTasks";
import { weekDays } from "@/lib/dates";
import { TimeGrid } from "./TimeGrid";
import type { DraftControls } from "./useDraft";

export function WeekView({ date, sessions, tz, drafts, tasks }: { date: string; sessions: Session[]; tz: string; drafts: DraftControls; tasks?: CalendarTasks }) {
  return <TimeGrid days={weekDays(date)} sessions={sessions} tz={tz} drafts={drafts} tasks={tasks} />;
}
