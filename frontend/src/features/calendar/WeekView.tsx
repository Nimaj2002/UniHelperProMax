import type { Session } from "@/features/classes/api";
import { weekDays } from "@/lib/dates";
import { TimeGrid } from "./TimeGrid";

export function WeekView({ date, sessions, tz }: { date: string; sessions: Session[]; tz: string }) {
  return <TimeGrid days={weekDays(date)} sessions={sessions} tz={tz} />;
}
