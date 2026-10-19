import { useCallback, useState } from "react";
import { readLocal, writeLocal } from "@/lib/storage";

export type TaskView = "board" | "list";
export const TASK_VIEW_KEY = "uh.tasks.view";

/** Board or List, remembered per browser. */
export function useTaskView(): [TaskView, (view: TaskView) => void] {
  const [view, setView] = useState<TaskView>(() => (readLocal<unknown>(TASK_VIEW_KEY, "board") === "list" ? "list" : "board"));
  const set = useCallback((v: TaskView) => {
    setView(v);
    writeLocal(TASK_VIEW_KEY, v);
  }, []);
  return [view, set];
}
