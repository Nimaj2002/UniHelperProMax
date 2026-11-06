/**
 * The home page's right column (018): Tasks, General notes or (020) Time, one at a time, picked from the
 * switch in its header card. The choice is a per-browser convenience (localStorage) and the closed
 * panel's rail has an item per section.
 */
import { useEffect, useState } from "react";
import { readLocal, writeLocal } from "@/lib/storage";

export type ColumnSection = "tasks" | "notes" | "time" | "graph"; // 022: the knowledge graph

/** The header switch's button for each section (focus target when the rail opens one). */
export const SECTION_SWITCH_ID: Record<ColumnSection, string> = {
  tasks: "home-switch-tasks",
  notes: "home-switch-notes",
  time: "home-switch-time",
  graph: "home-switch-graph",
};
const SECTIONS: readonly ColumnSection[] = ["tasks", "notes", "time", "graph"];

const KEY = "uh.home.tasksSection";

export function useTasksColumn() {
  const [section, setSection] = useState<ColumnSection>(() => {
    const stored = readLocal<unknown>(KEY, "tasks");
    return SECTIONS.includes(stored as ColumnSection) ? (stored as ColumnSection) : "tasks";
  });
  useEffect(() => writeLocal(KEY, section), [section]);
  return { section, setSection };
}

export type TasksColumn = ReturnType<typeof useTasksColumn>;
