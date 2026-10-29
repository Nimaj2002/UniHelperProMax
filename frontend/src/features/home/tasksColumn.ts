/**
 * The home page's right column (018): Tasks above General notes, like the session panel's
 * Recordings above Chat. Each section collapses to its header and the closed panel's rail has an
 * item per section. Tasks' collapsed state and the split are a per-browser convenience
 * (localStorage, as the session panel); General notes' collapsed state is the account preference.
 */
import { useCallback, useEffect, useState } from "react";
import { usePreferences, useUpdatePreferences } from "@/features/sessions/api";
import { readLocal, writeLocal } from "@/lib/storage";

export type ColumnSection = "tasks" | "notes";

export const COLUMN_SECTION_ID: Record<ColumnSection, string> = { tasks: "home-tasks", notes: "home-general-notes" };

const KEY = "uh.home.tasksColumn";
/** Tasks' share of the column's height (percent) while both sections are expanded. */
export const DEFAULT_SHARE = 65;

interface Stored {
  tasksCollapsed: boolean;
  share: number;
}

function readStored(): Stored {
  const raw = readLocal<Partial<Stored> | null>(KEY, null);
  const share = raw?.share;
  return {
    tasksCollapsed: raw?.tasksCollapsed === true,
    share: typeof share === "number" && share >= 10 && share <= 90 ? share : DEFAULT_SHARE,
  };
}

export function useTasksColumn() {
  const [own, setOwn] = useState(readStored);
  useEffect(() => writeLocal(KEY, own), [own]);
  const prefs = usePreferences();
  const { mutate } = useUpdatePreferences();
  const collapsed: Record<ColumnSection, boolean> = {
    tasks: own.tasksCollapsed,
    notes: prefs.data?.generalNotesCollapsed ?? false,
  };
  const setCollapsed = useCallback(
    (section: ColumnSection, value: boolean) =>
      section === "tasks" ? setOwn((o) => ({ ...o, tasksCollapsed: value })) : mutate({ generalNotesCollapsed: value }),
    [mutate],
  );
  const setShare = useCallback((share: number) => setOwn((o) => ({ ...o, share })), []);
  return { collapsed, share: own.share, setCollapsed, setShare };
}

export type TasksColumn = ReturnType<typeof useTasksColumn>;

