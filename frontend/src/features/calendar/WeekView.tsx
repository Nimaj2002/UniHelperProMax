import type { Session } from "@/features/classes/api";
import { weekDays } from "@/lib/dates";
import { TimeGrid } from "./TimeGrid";
import type { DraftControls } from "./useDraft";

export function WeekView({ date, sessions, tz, drafts }: { date: string; sessions: Session[]; tz: string; drafts: DraftControls }) {
  return <TimeGrid days={weekDays(date)} sessions={sessions} tz={tz} drafts={drafts} />;
}
