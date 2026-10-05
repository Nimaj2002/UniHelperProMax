import { useActivities } from "./registry";

/** Global activity strip visible on every authenticated screen; empty in feature 001. */
export function ActivityBar() {
  const activities = useActivities();
  if (activities.length === 0) return null;
  return (
    <div role="region" aria-label="Activity" className="border-t border-divider bg-surface-elevated empty:hidden">
      {activities.map(({ id, component: C }) => (
        <C key={id} />
      ))}
    </div>
  );
}
