/** 026: the Simple sidebar's entries, ordered general → specific (spec FR-004). Pure, so the order is unit-tested. */
import { BookOpen, CalendarBlank, CheckSquare, type Icon } from "@phosphor-icons/react";

export interface SidebarEntry {
  id: string;
  label: string;
  to: string;
  icon: Icon;
}

/** Workspace-wide areas. Events live in the calendar; the AI chat lives inside a session (see the session sidebar). */
export const GENERAL_ENTRIES: readonly SidebarEntry[] = [
  { id: "calendar", label: "Calendar", to: "/", icon: CalendarBlank },
  { id: "courses", label: "Courses", to: "/courses", icon: BookOpen },
  { id: "tasks", label: "Tasks", to: "/tasks", icon: CheckSquare },
];

/** The way back from a session: the same workspace-wide entries, Calendar only (Courses and Tasks are left out inside a session). */
export const SESSION_BACK_ENTRIES: readonly SidebarEntry[] = GENERAL_ENTRIES.filter((e) => e.id === "calendar");

/** Whether a route belongs to an entry: Calendar owns "/" and "/calendar/…", the rest their own prefix. */
export function isCurrent(entry: SidebarEntry, pathname: string): boolean {
  if (entry.id === "calendar") return pathname === "/" || pathname.startsWith("/calendar");
  return pathname === entry.to || pathname.startsWith(`${entry.to}/`);
}
