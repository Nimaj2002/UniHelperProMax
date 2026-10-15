/**
 * Opening a task's details from anywhere on the home page (FR-048, FR-050, FR-052): the Tasks
 * panel is opened (the width rules apply, so the Calendar may close to make room) and the panel
 * shows the details sheet of the task. Outside the home page, navigate to `/?task=<id>` instead
 * (`taskHref`) — `HomePage` handles the parameter the same way.
 */
import { useCallback } from "react";
import { useHomePanels } from "./usePanels";

let pending: string | null = null;
const listeners = new Set<() => void>();

/** Ask the Tasks panel to show `taskId`'s details (it consumes the request). */
export function requestTaskDetails(taskId: string) {
  pending = taskId;
  listeners.forEach((l) => l());
}

/** The pending request, left in place. */
export function pendingTaskRequest(): string | null {
  return pending;
}

/** Read and clear the pending request. */
export function takeTaskRequest(): string | null {
  const id = pending;
  pending = null;
  return id;
}

/** Called on each request (the Tasks panel takes it with `takeTaskRequest`). */
export function onTaskRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The link to a task from another page (course page, side card). */
export const taskHref = (taskId: string) => `/?task=${encodeURIComponent(taskId)}`;

/** Open the Tasks panel (width rules apply) and the details of a task. */
export function useOpenTaskDetails(): (taskId: string) => void {
  const panels = useHomePanels();
  return useCallback(
    (taskId: string) => {
      panels.open("tasks");
      requestTaskDetails(taskId);
    },
    [panels],
  );
}
