/**
 * The home page's right column (018): Tasks or General notes, one at a time, picked from the
 * switch in its header card. The choice is a per-browser convenience (localStorage) and the closed
 * panel's rail has an item per section.
 */
import { useEffect, useState } from "react";
import { readLocal, writeLocal } from "@/lib/storage";

export type ColumnSection = "tasks" | "notes";

/** The header switch's button for each section (focus target when the rail opens one). */
export const SECTION_SWITCH_ID: Record<ColumnSection, string> = { tasks: "home-switch-tasks", notes: "home-switch-notes" };

const KEY = "uh.home.tasksSection";

export function useTasksColumn() {
  const [section, setSection] = useState<ColumnSection>(() => (readLocal<unknown>(KEY, "tasks") === "notes" ? "notes" : "tasks"));
  useEffect(() => writeLocal(KEY, section), [section]);
  return { section, setSection };
}

export type TasksColumn = ReturnType<typeof useTasksColumn>;
