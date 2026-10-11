import type { Session } from "@/features/classes/api";
import { TimeGrid } from "./TimeGrid";
import type { DraftControls } from "./useDraft";

export function DayView({ date, sessions, tz, drafts }: { date: string; sessions: Session[]; tz: string; drafts: DraftControls }) {
  return <TimeGrid days={[date]} sessions={sessions.filter((s) => s.date === date)} tz={tz} drafts={drafts} />;
}
