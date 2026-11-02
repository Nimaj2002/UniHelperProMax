/**
 * Time mode of the home page's right panel (020 FR-005): a header card, then the timer card, a
 * Today / Reports switch and the chosen view. No other fixed bar; works at the panel's 320 px.
 */
import { Tag as TagIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { Card } from "@/app/shell/Card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { readLocal, writeLocal } from "@/lib/storage";
import { TagManager } from "./TagManager";
import { TimerCard } from "./TimerCard";
import { TodayList } from "./TodayList";

const ReportsView = lazy(() => import("./reports/ReportsView").then((m) => ({ default: m.ReportsView })));
type View = "today" | "reports";
const VIEW_KEY = "uh.time.view";

interface Props {
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function TimePanel({ leading, trailing }: Props) {
  const [view, setViewState] = useState<View>(() => (readLocal<unknown>(VIEW_KEY, "today") === "reports" ? "reports" : "today"));
  const setView = (v: View) => {
    setViewState(v);
    writeLocal(VIEW_KEY, v);
  };
  const [tags, setTags] = useState(false);
  return (
    <>
      <Card className="shrink-0" body="fill">
        <div data-panel-header className="flex h-10 min-w-0 shrink-0 items-center gap-1 px-1.5">
          {leading}
          <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold tracking-tight">Time</h2>
          <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="Manage tags" title="Manage tags" onClick={() => setTags(true)}>
            <TagIcon size={16} aria-hidden />
          </Button>
          {trailing}
        </div>
      </Card>
      <Card id="home-time-body" className="flex-1" bodyClassName="flex flex-col gap-3 px-2.5 py-2.5">
        <TimerCard />
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as View)} aria-label="Today or reports" className="h-7 self-start">
          <ToggleGroupItem value="today" className="h-7 px-2.5 text-xs">
            Today
          </ToggleGroupItem>
          <ToggleGroupItem value="reports" className="h-7 px-2.5 text-xs">
            Reports
          </ToggleGroupItem>
        </ToggleGroup>
        {view === "today" ? (
          <TodayList />
        ) : (
          <Suspense fallback={<p className="text-xs text-text-muted">Loading reports…</p>}>
            <ReportsView />
          </Suspense>
        )}
      </Card>
      {tags && <TagManager onClose={() => setTags(false)} />}
    </>
  );
}
