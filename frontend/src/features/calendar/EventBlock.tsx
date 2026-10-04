import { forwardRef, type ComponentPropsWithoutRef } from "react";
import type { Session } from "@/features/classes/api";
import { formatDay, wallTime } from "@/lib/dates";
import { eventStyle, type ColorKey } from "@/lib/palette";
import { cn } from "@/lib/utils";

export function sessionLabel(s: Session): string {
  const name = s.title ? `${s.courseName} ${s.title}` : s.courseName;
  const loc = s.location ? `, ${s.location}` : "";
  return `${name}, ${formatDay(s.date)}, ${wallTime(s.start)} to ${wallTime(s.end)}${loc}`;
}

interface Props extends ComponentPropsWithoutRef<"button"> {
  session: Session;
  compact?: boolean;
}

/** A session on the calendar: course name, title, time, location in the class colour (FR-009). */
export const EventBlock = forwardRef<HTMLButtonElement, Props>(function EventBlock(
  { session, compact, className, style, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={sessionLabel(session)}
      data-session-key={session.key}
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-[6px] border border-l-[3px] px-1.5 py-1 text-left text-xs leading-tight",
        "transition-[filter] hover:brightness-[0.97] focus-visible:z-20 active:scale-[0.99]",
        className,
      )}
      style={{ ...eventStyle(session.color as ColorKey), ...style }}
      {...rest}
    >
      <span className="truncate font-semibold">
        {session.courseName}
        {session.title && <span className="font-normal"> · {session.title}</span>}
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
  );
});
