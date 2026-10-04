import type { Session } from "@/features/classes/api";
import { TimeGrid } from "./TimeGrid";

export function DayView({ date, sessions, tz }: { date: string; sessions: Session[]; tz: string }) {
  return <TimeGrid days={[date]} sessions={sessions.filter((s) => s.date === date)} tz={tz} />;
}
