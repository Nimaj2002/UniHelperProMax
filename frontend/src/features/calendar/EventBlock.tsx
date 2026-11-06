import { CalendarStar, Kanban } from "@phosphor-icons/react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Session } from "@/features/classes/api";
import { useOpenTaskDetails } from "@/features/home/openTask";
import { formatDay, minutesOf, wallTime } from "@/lib/dates";
import { eventStyle, type ColorKey } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { endDrag, startDrag } from "./dnd";

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
 * It can be dragged to another day or time (`dnd.ts`).
 */
export const EventBlock = forwardRef<HTMLButtonElement, Props>(function EventBlock(
  { session, kind = session.kind, compact, className, style, ...rest },
  ref,
) {
  const event = kind === "event";
  const full = entryName(session);
  const taskId = session.taskId ?? null;
  const block = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={sessionLabel({ ...session, kind })}
          data-session-key={session.key}
          data-kind={kind}
          draggable
          onDragStart={(e) => {
            const start = minutesOf(session.start);
            startDrag(e, {
              kind: "session", key: session.key, date: session.date, name: full,
              color: session.color as ColorKey, startMin: start, lengthMin: Math.max(minutesOf(session.end) - start, 15),
            });
          }}
          onDragEnd={endDrag}
          className={cn(
            "flex w-full flex-col overflow-hidden rounded-[6px] border border-l-[3px] px-1.5 py-1 text-left text-xs leading-tight",
            "transition-[filter,opacity] hover:brightness-[0.97] focus-visible:z-20 active:scale-[0.99] data-[dragging]:opacity-40",
            taskId ? cn("h-full pr-6", compact && "py-0.5") : className,
          )}
          style={{
            ...eventStyle(session.color as ColorKey),
            ...(event ? { borderLeftColor: "var(--event-marker)", borderLeftStyle: "dashed" } : null),
            ...(taskId ? null : style),
          }}
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
  if (!taskId) return block;
  // 012 FR-050: an event on the board carries an "On board" button beside its own button (a
  // button can't hold another); the wrapper takes the block's position
  return (
    <div className={cn("relative", className)} style={style}>
      {block}
      <OnBoardButton taskId={taskId} title={session.title ?? ""} />
    </div>
  );
});

function OnBoardButton({ taskId, title }: { taskId: string; title: string }) {
  const openDetails = useOpenTaskDetails();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-no-drag
          data-on-board={taskId}
          aria-label={`On board: open task ${title}`}
          onClick={() => openDetails(taskId)}
          className="absolute top-0.5 right-0.5 z-10 grid size-4 place-items-center rounded-sm bg-surface-elevated/80 text-foreground outline-none hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Kanban size={12} weight="bold" aria-hidden />
          <span className="sr-only">On board</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">On board · open task</TooltipContent>
    </Tooltip>
  );
}
