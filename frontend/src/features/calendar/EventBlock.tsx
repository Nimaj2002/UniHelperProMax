import { CalendarStar } from "@phosphor-icons/react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Session } from "@/features/classes/api";
import { formatDay, wallTime } from "@/lib/dates";
import { eventStyle, type ColorKey } from "@/lib/palette";
import { cn } from "@/lib/utils";

export type EntryKind = "class" | "event";

/** The entry's name: course name and class title, or (009) the event's title. */
export function entryName(s: Pick<Session, "kind" | "courseName" | "title">): string {
  if (s.kind === "event") return s.title ?? "";
  return s.title ? `${s.courseName} ${s.title}` : (s.courseName ?? "");
}

export function sessionLabel(s: Session): string {
  const prefix = s.kind === "event" ? "Event: " : "";
  const loc = s.location ? `, ${s.location}` : "";
  return `${prefix}${entryName(s)}, ${formatDay(s.date)}, ${wallTime(s.start)} to ${wallTime(s.end)}${loc}`;
}

interface Props extends ComponentPropsWithoutRef<"button"> {
  session: Session;
  /** Class or (009) event; defaults to the session's own kind. */
  kind?: EntryKind;
  compact?: boolean;
}

/**
 * An entry on the calendar (FR-009; 009 FR-007/FR-008): course name, title, time, location in its
 * colour. Events add a calendar-star icon, a dashed marker edge and "Event:" in their name, so the
 * kind never depends on colour. The full title shows in a tooltip on hover and keyboard focus.
 */
export const EventBlock = forwardRef<HTMLButtonElement, Props>(function EventBlock(
  { session, kind = session.kind, compact, className, style, ...rest },
  ref,
) {
  const event = kind === "event";
  const full = entryName(session);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={sessionLabel({ ...session, kind })}
          data-session-key={session.key}
          data-kind={kind}
          className={cn(
            "flex w-full flex-col overflow-hidden rounded-[6px] border border-l-[3px] px-1.5 py-1 text-left text-xs leading-tight",
            "transition-[filter] hover:brightness-[0.97] focus-visible:z-20 active:scale-[0.99]",
            className,
          )}
          style={{ ...eventStyle(session.color as ColorKey), ...(event ? { borderLeftColor: "var(--event-marker)", borderLeftStyle: "dashed" } : null), ...style }}
          {...rest}
        >
          <span className="flex min-w-0 items-center gap-1 truncate font-semibold">
            {event && <CalendarStar size={12} weight="bold" aria-hidden className="shrink-0" data-testid="event-marker" />}
            {event ? (
              <span className="truncate">{session.title}</span>
            ) : (
              <span className="truncate">
                {session.courseName}
                {session.title && <span className="font-normal"> · {session.title}</span>}
              </span>
            )}
          </span>
          {!compact && (
            <>
              <span className="truncate tabular-nums opacity-90">
                {wallTime(session.start)}–{wallTime(session.end)}
              </span>
              {session.location && <span className="truncate opacity-90">{session.location}</span>}
            </>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs break-words">
        {event && "Event: "}
        {full} · {wallTime(session.start)}–{wallTime(session.end)}
      </TooltipContent>
    </Tooltip>
  );
});
