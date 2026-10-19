import { useCallback, useState } from "react";
import { readLocal, writeLocal } from "@/lib/storage";
import { FILTERS_KEY, NO_FILTERS, parseFilters, type TaskFilters } from "./model/filters";

/** The Tasks panel's filters, remembered per browser (FR-034). */
export function useTaskFilters(): [TaskFilters, (change: Partial<TaskFilters> | null) => void] {
  const [filters, setFilters] = useState<TaskFilters>(() => parseFilters(readLocal<unknown>(FILTERS_KEY, null)));
  /** Merge a change; `null` clears every filter. */
  const update = useCallback((change: Partial<TaskFilters> | null) => {
    setFilters((current) => {
      const next = change === null ? NO_FILTERS : { ...current, ...change };
      writeLocal(FILTERS_KEY, next);
      return next;
    });
  }, []);
  return [filters, update];
}
