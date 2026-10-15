/**
 * The fields of the API's Task / TaskColumn (contracts/openapi.yaml) the pure model helpers need.
 * The generated `Schemas["Task"]` and `Schemas["TaskColumn"]` satisfy these shapes, so the helpers
 * work on API data without depending on the generated types.
 */
export interface LinkedEventLike {
  sessionKey: string;
  title: string;
  date: string;
  start?: string | null;
}

export interface TaskLike {
  id: string;
  columnId: string;
  position: number;
  title: string;
  /** YYYY-MM-DD in the user's time zone. */
  dueDate: string | null;
  /** HH:MM, only with a due date. */
  dueTime: string | null;
  courseId: string | null;
  event: LinkedEventLike | null;
  completedAt: string | null;
  previousColumnId?: string | null;
}

export interface ColumnLike {
  id: string;
  name: string;
  position: number;
  countsAsDone: boolean;
}
