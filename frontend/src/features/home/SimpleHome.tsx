/** 026: Simple's landing page and Tasks page: the same panels Ultimate's home page shows, one at a time and full width. */
import { Navigate } from "react-router";
import { useBareMain } from "@/app/shell/layout";
import { ShowSidePanelButton } from "@/app/shell/MainBarControls";
import { useUiMode } from "@/app/uiMode";
import { CalendarPanel } from "./CalendarPanel";
import { TasksPanel } from "./TasksPanel";
import { useTasksColumn } from "./tasksColumn";

export function SimpleCalendar() {
  useBareMain();
  return (
    <div className="h-full min-h-0 min-w-0 flex-1">
      <CalendarPanel open leading={<ShowSidePanelButton />} />
    </div>
  );
}

/** The Tasks panel's header also switches to General notes and Time, as on Ultimate's home page. */
export function SimpleTasks() {
  useBareMain();
  const { mode, ready } = useUiMode();
  const column = useTasksColumn();
  if (ready && mode !== "simple") return <Navigate to="/" replace />; // Ultimate shows tasks in its home panel
  return (
    <div className="h-full min-h-0 min-w-0 flex-1">
      <TasksPanel open leading={<ShowSidePanelButton />} column={column} />
    </div>
  );
}
