import type { Session } from "@/features/classes/api";
import type { CalendarTasks } from "@/features/tasks/calendar/useCalendarTasks";
import { TimeGrid } from "./TimeGrid";
import type { DraftControls } from "./useDraft";

export function DayView({ date, sessions, tz, drafts, tasks }: { date: string; sessions: Session[]; tz: string; drafts: DraftControls; tasks?: CalendarTasks }) {
  return <TimeGrid days={[date]} sessions={sessions.filter((s) => s.date === date)} tz={tz} drafts={drafts} tasks={tasks} />;
}
