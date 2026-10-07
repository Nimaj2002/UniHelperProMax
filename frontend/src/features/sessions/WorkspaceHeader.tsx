import { ArrowLeft, SidebarSimple } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Session } from "@/features/classes/api";
import { formatDay, wallTime } from "@/lib/dates";
import { statusAt, useNow } from "./useNow";

interface Props {
  courseId: string;
  session: Session | undefined;
  leftOpen: boolean;
  rightOpen: boolean;
  /** Only on narrow screens, where it opens the drawer; on desktop the section collapses from
   * its own header and Alt+[ still works. */
  onToggleLeft?: () => void;
  onToggleRight: () => void;
}

/** Course, date, time, location and a way back (FR-009); panel toggles (FR-008). */
export function WorkspaceHeader({ courseId, session, leftOpen, rightOpen, onToggleLeft, onToggleRight }: Props) {
  const startMs = session ? Date.parse(session.start) : undefined;
  const now = useNow(startMs);
  const upcoming = session ? statusAt(session.start, now) === "upcoming" : false;
  return (
    <header className="flex min-w-0 items-center gap-2 border-b border-divider px-2 py-2 sm:px-3">
      {onToggleLeft && (
        <Button variant="ghost" size="icon" onClick={onToggleLeft} aria-pressed={leftOpen} aria-label={leftOpen ? "Hide sessions and notes" : "Show sessions and notes"} aria-keyshortcuts="Alt+[">
          <SidebarSimple size={18} />
        </Button>
      )}
      <Link to={`/courses/${courseId}`} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
        <ArrowLeft size={14} aria-hidden />
        <span className="max-w-40 truncate">{session?.courseName ?? "Course"}</span>
      </Link>
      {session && (
        <h1 className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-sm font-semibold sm:text-base">
          <span className="truncate">
            {formatDay(session.date, "EEE d MMM yyyy")} · {wallTime(session.start)}–{wallTime(session.end)}
            {session.title && ` · ${session.title}`}
          </span>
          {session.location && <span className="truncate font-normal text-muted-foreground">{session.location}</span>}
          {upcoming && <Badge variant="outline">Upcoming</Badge>}
          {session.scheduled === false && <Badge variant="outline">No longer scheduled</Badge>}
        </h1>
      )}
      <Button variant="ghost" size="icon" className="ml-auto scale-x-[-1]" onClick={onToggleRight} aria-pressed={rightOpen} aria-label={rightOpen ? "Hide audio panel" : "Show audio panel"} aria-keyshortcuts="Alt+]">
        <SidebarSimple size={18} />
      </Button>
    </header>
  );
}
