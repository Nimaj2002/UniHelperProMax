import { ArrowSquareOut, CalendarBlank } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Session } from "@/features/classes/api";
import { formatDay, wallTime } from "@/lib/dates";
import { useNow } from "./useNow";

type Phase = "upcoming" | "in-progress" | "past";
const PHASE_LABEL: Record<Phase, string> = { upcoming: "Upcoming", "in-progress": "In progress", past: "Past" };

export function sessionPhase(session: Pick<Session, "start" | "end">, now: number): Phase {
  if (Date.parse(session.start) > now) return "upcoming";
  return Date.parse(session.end) > now ? "in-progress" : "past";
}

/**
 * The session's date and time in the workspace tab row (008 FR-016), with an "Upcoming" marker;
 * it opens the course, location, links and status (what the old session header showed).
 */
export function SessionChip({ session }: { session: Session }) {
  const now = useNow([session.start, session.end]);
  const phase = sessionPhase(session, now);
  const upcoming = phase === "upcoming";
  const time = `${wallTime(session.start)}–${wallTime(session.end)}`;
  const name = `Session details: ${formatDay(session.date, "EEEE d MMMM yyyy")}, ${time}${upcoming ? ", upcoming" : ""}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={name} className="h-7 shrink-0 gap-1.5 rounded-full px-2.5 font-normal">
          <CalendarBlank size={14} aria-hidden />
          <span className="whitespace-nowrap">
            {formatDay(session.date, "EEE d MMM")}
            <span className="hidden @[40rem]/main:inline"> · {time}</span>
          </span>
          {upcoming && (
            <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
              Upcoming
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="grid gap-3 text-sm">
          <div className="grid gap-0.5">
            <Link to={`/courses/${session.courseId}`} className="justify-self-start font-medium text-primary underline-offset-4 hover:underline">
              {session.courseName}
            </Link>
            <p className="text-muted-foreground">
              {formatDay(session.date, "EEEE d MMMM yyyy")} · {time}
            </p>
            {session.title && <p>{session.title}</p>}
          </div>
          {session.location && (
            <div className="grid gap-0.5">
              <span className="text-xs font-medium text-muted-foreground">Location</span>
              <span>{session.location}</span>
            </div>
          )}
          {session.links.length > 0 && (
            <div className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Links</span>
              <ul className="grid gap-1">
                {session.links.map((l) => (
                  <li key={l.url} className="min-w-0">
                    <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-4 hover:underline">
                      <span className="truncate">{l.label || l.url}</span>
                      <ArrowSquareOut size={12} aria-hidden className="shrink-0" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Status</span>
            <Badge variant="outline">{PHASE_LABEL[phase]}</Badge>
            {session.scheduled === false && <Badge variant="outline">No longer scheduled</Badge>}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
