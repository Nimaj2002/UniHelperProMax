/**
 * Reports (020 US10): total and breakdown for today, this week, this month or a custom range, with
 * previous/next; grouped by tag, course or day; as a table (always available, first) or a donut.
 * Choosing a row or slice lists its entries. P3: weekly totals and CSV export.
 */
import { CaretLeft, CaretRight, DownloadSimple } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMe } from "@/features/auth/api";
import { useCourseOptions } from "@/features/tasks/useCourseOptions";
import { API_BASE } from "@/lib/api";
import { endOfMonthISO, formatDay, shiftDay, shiftMonth, todayISO, weekRange } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useEntries, useTags } from "../api";
import { formatDuration } from "../clock";
import { dayBounds, localDay, rangeOf, timeOfDay } from "../days";
import { TagLabel } from "../TagPicker";
import { DonutChart } from "./DonutChart";
import { buildReport, chartSlices, type Group } from "./report";

type Period = "today" | "week" | "month" | "custom";

function periodDays(period: Period, anchor: string, custom: { from: string; to: string }): { first: string; last: string; label: string } {
  if (period === "today") return { first: anchor, last: anchor, label: formatDay(anchor, "EEE d MMM yyyy") };
  if (period === "week") {
    const { from, to } = weekRange(anchor);
    return { first: from, last: to, label: `${formatDay(from, "d MMM")} – ${formatDay(to, "d MMM yyyy")}` };
  }
  if (period === "month") {
    const first = `${anchor.slice(0, 7)}-01`;
    return { first, last: endOfMonthISO(first), label: formatDay(first, "MMMM yyyy") };
  }
  return { first: custom.from, last: custom.to, label: `${formatDay(custom.from, "d MMM")} – ${formatDay(custom.to, "d MMM yyyy")}` };
}

export function ReportsView() {
  const tz = useMe().data?.timezone ?? "UTC";
  const today = todayISO(tz);
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState({ from: shiftDay(today, -6), to: today });
  const [group, setGroup] = useState<Group>("tag");
  const [view, setView] = useState<"table" | "chart">("table");
  const [selected, setSelected] = useState<string | null>(null);
  const tagData = useTags().data;
  const tags = useMemo(() => tagData ?? [], [tagData]);
  const courses = useCourseOptions();

  const customValid = custom.from <= custom.to;
  const { first, last, label } = periodDays(period, anchor, custom);
  const { from, to } = rangeOf(first, customValid ? last : first, tz);
  const entries = useEntries(from, to);
  const report = useMemo(
    () =>
      buildReport(entries.data ?? [], Date.parse(from), Date.parse(to), group, tz, {
        tag: (id) => tags.find((t) => t.id === id),
        course: (id) => courses.find((c) => c.id === id)?.name,
        day: (iso) => formatDay(iso, "EEE d MMM"),
      }),
    [entries.data, from, to, group, tz, tags, courses],
  );
  const slices = useMemo(() => chartSlices(report.rows), [report.rows]);
  const chosen = [...report.rows, ...slices].find((r) => r.key === selected) ?? null;

  const step = (dir: -1 | 1) => {
    setSelected(null);
    if (period === "today") setAnchor(shiftDay(anchor, dir));
    else if (period === "week") setAnchor(shiftDay(anchor, 7 * dir));
    else if (period === "month") setAnchor(shiftMonth(`${anchor.slice(0, 7)}-01`, dir));
    else {
      const days = Math.round((dayBounds(custom.to, tz).end - dayBounds(custom.from, tz).start) / 86_400_000);
      setCustom({ from: shiftDay(custom.from, days * dir), to: shiftDay(custom.to, days * dir) });
    }
  };
  const tagOf = (id: string | null | undefined) => tags.find((t) => t.id === id) ?? null;
  const exportHref = `${API_BASE}/time/entries/export.csv?${new URLSearchParams({ from, to, tz })}`;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <ToggleGroup type="single" variant="outline" size="sm" value={period} onValueChange={(v) => v && (setPeriod(v as Period), setAnchor(today), setSelected(null))} aria-label="Period" className="h-7">
          <ToggleGroupItem value="today" className="h-7 px-2 text-xs">Today</ToggleGroupItem>
          <ToggleGroupItem value="week" className="h-7 px-2 text-xs">Week</ToggleGroupItem>
          <ToggleGroupItem value="month" className="h-7 px-2 text-xs">Month</ToggleGroupItem>
          <ToggleGroupItem value="custom" className="h-7 px-2 text-xs">Custom</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {period === "custom" && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Input type="date" aria-label="From" value={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="h-7 w-36 text-xs" />
          <span>to</span>
          <Input type="date" aria-label="To" value={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="h-7 w-36 text-xs" aria-invalid={!customValid} />
          {!customValid && <span className="text-danger">The end must be on or after the start.</span>}
        </div>
      )}
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" className="size-7" aria-label="Previous period" onClick={() => step(-1)}>
          <CaretLeft size={14} aria-hidden />
        </Button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-medium">{label}</span>
        <Button size="icon" variant="ghost" className="size-7" aria-label="Next period" onClick={() => step(1)}>
          <CaretRight size={14} aria-hidden />
        </Button>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">Total</span>
        <span className="text-lg font-semibold tabular-nums">{formatDuration(report.total)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={group} onValueChange={(v) => (setGroup(v as Group), setSelected(null))}>
          <SelectTrigger className="h-7 w-32 text-xs" aria-label="Group by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tag">By tag</SelectItem>
            <SelectItem value="course">By course</SelectItem>
            <SelectItem value="day">By day</SelectItem>
          </SelectContent>
        </Select>
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as "table" | "chart")} aria-label="Show as" className="h-7">
          <ToggleGroupItem value="table" className="h-7 px-2 text-xs">Table</ToggleGroupItem>
          <ToggleGroupItem value="chart" className="h-7 px-2 text-xs">Chart</ToggleGroupItem>
        </ToggleGroup>
        <Button asChild size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-xs">
          <a href={exportHref} download>
            <DownloadSimple size={14} aria-hidden /> CSV
          </a>
        </Button>
      </div>

      {entries.isError && <p role="alert" className="text-xs text-danger">Couldn't load the entries for this period.</p>}
      {report.rows.length === 0 && !entries.isPending ? (
        <p className="text-xs text-text-muted">No time tracked in this period.</p>
      ) : view === "table" ? (
        <table className="w-full table-fixed text-xs">
          <caption className="sr-only">Tracked time {label}, grouped by {group}</caption>
          <thead className="text-left text-text-muted">
            <tr>
              <th scope="col" className="py-1 font-medium">Name</th>
              <th scope="col" className="w-16 py-1 text-right font-medium">Time</th>
              <th scope="col" className="w-11 py-1 text-right font-medium">Share</th>
              <th scope="col" className="w-12 py-1 text-right font-medium">Entries</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {report.rows.map((r) => (
              <tr key={r.key} className={cn(selected === r.key && "bg-surface-hover")}>
                <th scope="row" className="py-1 text-left font-normal">
                  <button type="button" className="flex w-full min-w-0 items-center rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-pressed={selected === r.key} onClick={() => setSelected(selected === r.key ? null : r.key)}>
                    {group === "tag" ? <TagLabel tag={r.key === "none" ? null : { name: r.name, color: r.color ?? "" }} /> : <span className="truncate">{r.name}</span>}
                  </button>
                </th>
                <td className="py-1 text-right tabular-nums">{formatDuration(r.seconds)}</td>
                <td className="py-1 text-right tabular-nums">{Math.round(r.share * 100)}%</td>
                <td className="py-1 text-right tabular-nums">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <DonutChart slices={slices} total={report.total} selected={selected} onSelect={(k) => setSelected(selected === k ? null : k)} />
      )}

      {chosen && (
        <section aria-label={`Entries for ${chosen.name}`} className="flex flex-col gap-1 rounded-lg border border-divider p-2">
          <h4 className="text-xs font-semibold">{chosen.name}</h4>
          <ul className="flex flex-col gap-1 text-xs">
            {chosen.entries.map((e) => (
              <li key={e.id} className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 tabular-nums text-text-muted">
                  {formatDay(localDay(Date.parse(e.startedAt), tz), "d MMM")} {timeOfDay(Date.parse(e.startedAt), tz)}
                </span>
                <span className="min-w-0 flex-1 truncate">{e.description || e.linkTitle || "(no description)"}</span>
                {group !== "tag" && e.tagId && <TagLabel tag={tagOf(e.tagId)} className="max-w-[30%]" />}
                <span className="shrink-0 tabular-nums">{formatDuration(e.durationSeconds)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
