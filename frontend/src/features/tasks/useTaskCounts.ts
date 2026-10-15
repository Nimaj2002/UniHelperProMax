import { useMemo } from "react";
import { useMe } from "@/features/auth/api";
import { useTaskColumns, useTasks } from "./api";
import { openCount, overdueCount } from "./model/counts";
import { useNow } from "./useNow";

/**
 * The Tasks rail's numbers (FR-073, FR-074) from the shared `["tasks"]` cache, re-evaluated every
 * minute so a passing due time shows without a reload. Unknown (undefined) while loading or when
 * the tasks failed to load: the rail then shows no count.
 */
export function useTaskCounts(): { open?: number; overdue?: number } {
  const tasks = useTasks();
  const columns = useTaskColumns();
  const { data: me } = useMe();
  const now = useNow();
  const tz = me?.timezone ?? "UTC";
  return useMemo(() => {
    if (!tasks.data || !columns.data || tasks.isError || columns.isError) return {};
    return { open: openCount(tasks.data, columns.data), overdue: overdueCount(tasks.data, columns.data, now, tz) };
  }, [tasks.data, columns.data, tasks.isError, columns.isError, now, tz]);
}
