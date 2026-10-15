import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { CreatableCombobox } from "@/components/form/CreatableCombobox";
import { Field } from "@/components/form/Field";
import { FormError } from "@/components/form/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { classPayload, serverErrors } from "@/features/classes/ClassForm";
import { emptyHierarchy, HierarchyPicker, useSemesterEnd } from "@/features/classes/HierarchyPicker";
import { LinksEditor, MAX_LINKS } from "@/features/classes/LinksEditor";
import { invalidateSchedule, useCreateClass, type ClassCreate } from "@/features/classes/api";
import { useCourseTree } from "@/features/courses/api";
import { useCreateEvent, type EventCreate } from "@/features/events/api";
import { eventPayload, eventServerErrors } from "@/features/events/EventForm";
import { hierarchyFrom, usePreselectedSemester } from "@/features/events/usePreselectedSemester";
import { usePreferences, useUpdatePreferences } from "@/features/sessions/api";
import { AddToKanbanFields } from "@/features/tasks/AddToKanbanFields";
import { apiFetch, isApiError, type Schemas } from "@/lib/api";
import { parseTimeHHmm } from "@/lib/dates";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import type { Draft } from "./draft";
import {
  courseOptions, initialQuickValue, isDirty, toClassForm, toEventForm, validateQuick, weekdayOf,
  type QuickErrors, type QuickType, type QuickValue, type RepeatChoice,
} from "./quickCreate";
import { slotSelector } from "./TimeGrid";
import type { DraftControls } from "./useDraft";

type CreatedRefs = Schemas["CreatedRefs"];

/** Focus back on the calendar when the form closes (FR-043): the new entry after a save,
 * otherwise the slot of the draft's start (day/week) or its day (month). */
export function focusCalendar(draft: Pick<Draft, "date" | "startMin">, sessionKey?: string) {
  requestAnimationFrame(() => {
    const el =
      (sessionKey ? document.querySelector<HTMLElement>(`[data-session-key="${CSS.escape(sessionKey)}"]`) : null) ??
      document.querySelector<HTMLElement>(slotSelector(draft.date, draft.startMin)) ??
      document.querySelector<HTMLElement>(`[data-month-day="${draft.date}"]`) ??
      document.querySelector<HTMLElement>("[data-calendar-grid] [data-slot-at][tabindex='0']");
    el?.focus();
  });
}

/** The quick form for the open draft (009 US6), or nothing. */
export function QuickCreate({ drafts }: { drafts: DraftControls }) {
  const { draft, phase } = drafts.state;
  if (!draft || phase !== "open") return null;
  return <QuickCreateShell key={draft.id} draft={draft} drafts={drafts} />;
}

type Virtual = { getBoundingClientRect: () => DOMRect; contextElement?: Element };

/** Anchor to the draft element; a new object whenever the draft moves, so the popover follows
 * it. Falls back to the last place it was seen (e.g. a date moved out of the visible week). */
function useDraftAnchor(draft: Draft): Virtual | null {
  const [anchor, setAnchor] = useState<Virtual | null>(null);
  const last = useRef<DOMRect | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>("[data-draft]");
    if (el) {
      last.current = el.getBoundingClientRect();
      setAnchor({
        getBoundingClientRect: () => {
          if (el.isConnected) last.current = el.getBoundingClientRect();
          return last.current!;
        },
        contextElement: el,
      });
    } else if (!last.current) {
      const r = document.querySelector("[data-calendar-grid]")?.getBoundingClientRect();
      const rect = r ? new DOMRect(r.x + r.width / 2, r.y + 80, 0, 0) : new DOMRect(0, 0, 0, 0);
      setAnchor({ getBoundingClientRect: () => rect });
    }
  }, [draft.date, draft.startMin, draft.endMin]);
  return anchor;
}

function QuickCreateShell({ draft, drafts }: { draft: Draft; drafts: DraftControls }) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const anchor = useDraftAnchor(draft);
  const { dirty } = drafts.state;
  const firstField = useRef<HTMLElement | null>(null);

  /** Escape, Cancel: discard and give the calendar its focus back (FR-039, FR-043). */
  const cancel = () => {
    drafts.discard(draft.id);
    focusCalendar(draft);
  };
  const onOpenChange = (open: boolean) => {
    if (!open) cancel();
  };
  const onInteractOutside = (e: Event) => {
    // something entered: the form stays open (FR-039); otherwise the outside press discards it
    if (dirty) e.preventDefault();
    else drafts.discard(draft.id);
  };
  // the fields focus their first required one once loaded (see QuickFields)
  const onOpenAutoFocus = (e: Event) => e.preventDefault();

  const body = <QuickCreateBody draft={draft} drafts={drafts} firstField={firstField} onCancel={cancel} />;

  if (!isDesktop) {
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[85dvh] overflow-y-auto rounded-t-xl p-4"
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={onInteractOutside}
        >
          <SheetTitle>New entry</SheetTitle>
          <SheetDescription className="sr-only">Add a class or an event at the selected time.</SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open modal={false} onOpenChange={onOpenChange}>
      {anchor && <PopoverAnchor virtualRef={{ current: anchor }} />}
      <PopoverContent
        role="dialog"
        aria-label="New entry"
        side="right"
        align="start"
        collisionPadding={12}
        className="max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={onInteractOutside}
      >
        <h2 className="mb-3 text-base font-semibold">New entry</h2>
        {body}
      </PopoverContent>
    </Popover>
  );
}

function QuickCreateBody({ draft, drafts, firstField, onCancel }: {
  draft: Draft;
  drafts: DraftControls;
  firstField: RefObject<HTMLElement | null>;
  onCancel: () => void;
}) {
  const prefs = usePreferences();
  const preselect = usePreselectedSemester();
  const tree = useCourseTree();
  if (!preselect.ready || prefs.isPending || tree.isPending) {
    return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;
  }
  // 009 FR-031: Class the first time, then the type used last; FR-033: semester preselection
  const type: QuickType = prefs.data?.quickCreateType ?? "class";
  const initial = initialQuickValue(draft, type, hierarchyFrom(preselect.pick, emptyHierarchy));
  return (
    <QuickFields
      draft={draft}
      drafts={drafts}
      initial={initial}
      firstField={firstField}
      onCancel={onCancel}
      preselectedSemesterId={preselect.pick?.semesterId}
    />
  );
}

const NOUN: Record<QuickType, string> = { class: "Class", event: "Event" };

function QuickFields({ draft, drafts, initial: opened, firstField, onCancel, preselectedSemesterId }: {
  draft: Draft;
  drafts: DraftControls;
  initial: QuickValue;
  firstField: RefObject<HTMLElement | null>;
  onCancel: () => void;
  preselectedSemesterId?: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tree = useCourseTree();
  const createClass = useCreateClass();
  const createEvent = useCreateEvent();
  const updatePrefs = useUpdatePreferences();
  // the values the form opened with (later refetches never make it "dirty", FR-039)
  const [initial] = useState(opened);
  const [value, setValue] = useState(opened);
  const [server, setServer] = useState<QuickErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const courses = useMemo(() => courseOptions(tree.data ?? [], preselectedSemesterId), [tree.data, preselectedSemesterId]);
  const picked = value.course?.kind === "existing" ? courses.find((c) => value.course?.kind === "existing" && c.id === value.course.id) : undefined;
  const semesterEnd = useSemesterEnd(picked ? toClassForm(value, courses).hierarchy : value.hierarchy);
  const errors: QuickErrors = { ...validateQuick(value, semesterEnd), ...server };
  const valid = Object.keys(validateQuick(value, semesterEnd)).length === 0;
  const weekday = value.date ? weekdayOf(value.date).name : "";

  const dirty = isDirty(value, initial);
  const { setDirty } = drafts;
  useEffect(() => {
    setDirty(draft.id, dirty);
  }, [setDirty, draft.id, dirty]);

  // the first empty required field takes focus on open (FR-043)
  const firstKey = value.type === "class" ? "course" : "title";
  useEffect(() => {
    const id = requestAnimationFrame(() => firstField.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [firstField]);

  const set = (patch: Partial<QuickValue>) => {
    const next = { ...value, ...patch };
    setValue(next);
    setServer({});
    if ("date" in patch || "startTime" in patch || "endTime" in patch) {
      // date and time edits move or resize the draft live (FR-034)
      if (next.date && next.startTime && next.endTime) {
        const startMin = parseTimeHHmm(next.startTime);
        const endMin = parseTimeHHmm(next.endTime);
        if (endMin > startMin) drafts.update(draft.id, { startMin, endMin }, next.date);
      }
    }
  };

  /** "More options" and "Custom…" repetition: the full form with everything entered (FR-034). */
  const openFull = (repeat: RepeatChoice = value.repeat) => {
    drafts.discard(draft.id);
    if (value.type === "class") navigate("/classes/new", { state: { prefill: toClassForm(value, courses, repeat) } });
    else navigate("/events/new", { state: { prefill: toEventForm(value, repeat) } });
  };

  const undo = async (created: CreatedRefs, version: number, noun: string) => {
    try {
      await apiFetch<void>("/creations/undo", { method: "POST", body: { created, version } });
      await invalidateSchedule(qc);
      toast.success(`${noun} removed`);
    } catch (err) {
      if (isApiError(err, "undo_unavailable")) toast.error("Can't undo: the entry already has content.");
      else toast.error("Undo didn't happen. The entry is still on your calendar.");
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setFormError(undefined);
    try {
      let made: { lineageId: string; version: number; created: CreatedRefs };
      let semesterId: string | null | undefined;
      if (value.type === "class") {
        const full = toClassForm(value, courses);
        const res = await createClass.mutateAsync(classPayload(full) as ClassCreate);
        made = res;
        semesterId = picked?.semesterId ?? (full.hierarchy.semester?.kind === "existing" ? full.hierarchy.semester.id : res.created.semesterId);
      } else {
        const res = await createEvent.mutateAsync(eventPayload(toEventForm(value)) as EventCreate);
        made = res;
        semesterId = res.semesterId;
      }
      updatePrefs.mutate({ quickCreateType: value.type, ...(semesterId ? { lastSemesterId: semesterId } : {}) });
      // the draft becomes the entry in place (the calendar has refetched by now) (FR-036)
      drafts.discard(draft.id);
      focusCalendar({ date: value.date, startMin: parseTimeHHmm(value.startTime) }, `${made.lineageId}:${value.date}`);
      const noun = NOUN[value.type];
      toast(`${noun} created`, {
        duration: 10_000,
        action: { label: "Undo", onClick: () => void undo(made.created, made.version, noun) },
      });
    } catch (err) {
      // keep every value; say what went wrong; Save stays available (FR-038)
      setPending(false);
      if (isApiError(err)) {
        const mapped = value.type === "class" ? serverErrors(err) : eventServerErrors(err);
        const { startDate, form, ...rest } = mapped;
        setServer({ ...(rest as QuickErrors), ...(startDate ? { date: startDate } : {}) });
        setFormError(form ?? err.title ?? "Couldn't save. Please try again.");
      } else {
        setFormError("Couldn't save. Check your connection and try again.");
      }
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[role='alert']")?.focus());
    }
  };

  const linkErrors = Object.fromEntries(
    Object.entries(errors).filter(([k]) => k.startsWith("link")).map(([k, msg]) => [Number(k.slice(4)), msg as string]),
  );
  const needsSemester = value.type === "event" || value.course?.kind === "new";
  const setFirst = (key: string) => (el: HTMLElement | null) => {
    if (key === firstKey) firstField.current = el;
  };

  return (
    <form ref={formRef} onSubmit={save} noValidate className="grid gap-4" aria-label="New entry">
      <FormError message={formError} />
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value.type}
        onValueChange={(t) => t && set({ type: t as QuickType })}
        aria-label="Entry type"
        className="w-full"
      >
        <ToggleGroupItem value="class" className="flex-1">Class</ToggleGroupItem>
        <ToggleGroupItem value="event" className="flex-1">Event</ToggleGroupItem>
      </ToggleGroup>

      {value.type === "class" ? (
        <Field label="Course" error={shown(errors.course, value.course !== initial.course || !!server.course)}>
          <CreatableCombobox
            ref={setFirst("course") as React.Ref<HTMLButtonElement>}
            noun="course"
            placeholder="Choose or create a course"
            items={courses.map((c) => ({ id: c.id, name: c.label }))}
            loading={tree.isPending}
            value={value.course?.kind === "existing" && picked ? { kind: "existing", id: picked.id, name: picked.label } : value.course}
            onChange={(course) =>
              set({ course: course?.kind === "existing" ? { ...course, name: courses.find((c) => c.id === course.id)?.name ?? course.name } : course })
            }
            aria-required
          />
        </Field>
      ) : (
        <Field label="Title" error={shown(errors.title, value.title !== initial.title || !!server.title)}>
          <Input
            ref={setFirst("title") as React.Ref<HTMLInputElement>}
            maxLength={120}
            value={value.title}
            onChange={(e) => set({ title: e.target.value })}
            aria-required
          />
        </Field>
      )}

      {needsSemester && (
        <HierarchyPicker
          levels="semester"
          value={value.hierarchy}
          onChange={(hierarchy) => set({ hierarchy })}
          errors={{
            year: shown(errors.year, value.hierarchy !== initial.hierarchy || !!server.year),
            semester: shown(errors.semester, value.hierarchy !== initial.hierarchy || !!server.semester),
          }}
        />
      )}

      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <Field label="Date" error={errors.date}>
          <Input type="date" value={value.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field label="Start time" error={errors.startTime}>
          <Input type="time" step={300} value={value.startTime} onChange={(e) => set({ startTime: e.target.value })} />
        </Field>
        <Field label="End time" error={errors.endTime}>
          <Input type="time" step={300} value={value.endTime} onChange={(e) => set({ endTime: e.target.value })} />
        </Field>
      </div>

      <Field label="Location (optional)" error={errors.location}>
        <Input maxLength={value.type === "event" ? 200 : 120} value={value.location} onChange={(e) => set({ location: e.target.value })} />
      </Field>

      <LinksEditor value={value.links.slice(0, MAX_LINKS)} onChange={(links) => set({ links })} errors={linkErrors} />

      <div className="grid gap-2">
        <Label id={`${uid}-repeat`}>Repeat</Label>
        <Select
          value={value.repeat}
          onValueChange={(r) => (r === "custom" ? openFull("weekly") : set({ repeat: r as RepeatChoice }))}
        >
          <SelectTrigger
            className="w-full"
            aria-labelledby={`${uid}-repeat`}
            aria-invalid={errors.repeat ? true : undefined}
            aria-describedby={errors.repeat ? `${uid}-repeat-error` : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Does not repeat</SelectItem>
            <SelectItem value="weekly" disabled={!weekday}>Weekly on {weekday}</SelectItem>
            <SelectItem value="custom">Custom…</SelectItem>
          </SelectContent>
        </Select>
        {errors.repeat && <p id={`${uid}-repeat-error`} className="text-sm text-danger">{errors.repeat}</p>}
      </div>

      {value.type === "event" && (
        <AddToKanbanFields
          value={value.addToBoard}
          onChange={(addToBoard) => set({ addToBoard })}
          repeating={value.repeat !== "none"}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-3">
        <Button type="button" variant="link" className="px-0" onClick={() => openFull()}>More options</Button>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={!valid || pending}>{pending ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </form>
  );
}

/** Required-field messages wait until the field was touched (Save is disabled meanwhile);
 * every other problem shows at once. */
function shown(message: string | undefined, touched: boolean): string | undefined {
  return touched ? message : undefined;
}
