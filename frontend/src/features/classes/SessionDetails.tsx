import { ArrowSquareOut, CalendarStar, Clock, MapPin, Repeat } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { lastCalendarPath } from "@/features/calendar/state";
import { useCourse } from "@/features/courses/api";
import { eventsPagePath, useEventDetail } from "@/features/events/api";
import { formatDay, wallTime } from "@/lib/dates";
import { swatchStyle, type ColorKey } from "@/lib/palette";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { useSession, type Session } from "./api";
import { useSessionActions } from "./session-actions";

function findEventElement(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-session-key="${CSS.escape(key)}"]`);
}

function Details({ session, close }: { session: Session; close: () => void }) {
  const event = session.kind === "event";
  const course = useCourse(session.courseId ?? undefined);
  const eventDetail = useEventDetail(event ? session.lineageId : undefined);
  const actions = useSessionActions();
  const where = course.data
    ? `${course.data.semester.name} · ${course.data.year.name}`
    : eventDetail.data
      ? `${eventDetail.data.semesterName} · ${eventDetail.data.yearName}`
      : null;
  return (
    <div className="grid gap-4 text-sm">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-1.5 size-3 shrink-0 rounded-sm" style={swatchStyle(session.color as ColorKey)} />
        <div className="min-w-0">
          {event && (
            <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <CalendarStar size={14} aria-hidden /> Event
            </p>
          )}
          <p className="break-words text-base font-semibold leading-snug">
            {event ? session.title : session.courseName}
            {!event && session.title && <span className="font-normal"> · {session.title}</span>}
          </p>
          {where && <p className="text-muted-foreground">{where}</p>}
        </div>
      </div>
      <ul className="grid gap-2">
        <Row icon={<Clock size={16} />}>
          {formatDay(session.date, "EEEE d MMMM yyyy")}, {wallTime(session.start)}–{wallTime(session.end)}
          {session.isException && <span className="ml-1 text-muted-foreground">(changed for this day)</span>}
        </Row>
        {session.location && <Row icon={<MapPin size={16} />}>{session.location}</Row>}
        <Row icon={<Repeat size={16} />}>{session.recurrenceSummary}</Row>
      </ul>
      {session.links.length > 0 && (
        <ul className="grid gap-1" aria-label="Links">
          {session.links.map((l) => (
            <li key={l.url}>
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-4 hover:underline"
              >
                <span className="truncate">{l.label || l.url}</span>
                <ArrowSquareOut size={14} aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 border-t border-divider pt-3">
        <Link
          to={event ? eventsPagePath(session.semesterId) : `/courses/${session.courseId}`}
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent"
        >
          {event ? "Semester events" : "Open course"}
        </Link>
        {actions.map(({ id, component: A }) => (
          <A key={id} session={session} close={close} />
        ))}
      </div>
    </div>
  );
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

/** Route /sessions/:sessionKey — remount per session so the anchor is re-resolved. */
export function SessionDetailsRoute() {
  const { sessionKey = "" } = useParams();
  return <SessionDetails key={sessionKey} sessionKey={sessionKey} />;
}

/** Popover anchored to the event (dialog on small screens or deep links). */
export function SessionDetails({ sessionKey }: { sessionKey: string }) {
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const session = useSession(sessionKey);
  // When opened from a visible event, anchor a popover to it; deep links fall back to a dialog.
  const [anchor] = useState(() => (typeof document === "undefined" ? null : findEventElement(sessionKey)));

  const close = () => {
    navigate(lastCalendarPath());
    requestAnimationFrame(() => findEventElement(sessionKey)?.focus());
  };

  const title = session.data
    ? session.data.kind === "event"
      ? `Event: ${session.data.title}`
      : `${session.data.courseName}${session.data.title ? ` · ${session.data.title}` : ""}`
    : "Session";
  const body = session.isError ? (
    <p className="text-sm text-danger">This session no longer exists.</p>
  ) : session.data ? (
    <Details session={session.data} close={close} />
  ) : (
    <p className="text-sm text-muted-foreground">Loading…</p>
  );

  if (isDesktop && anchor) {
    return (
      <Popover open onOpenChange={(o) => !o && close()}>
        <PopoverAnchor virtualRef={{ current: anchor }} />
        <PopoverContent role="dialog" aria-label={title} side="right" align="start" className="w-80" collisionPadding={12}>
          {body}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">Session details</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
