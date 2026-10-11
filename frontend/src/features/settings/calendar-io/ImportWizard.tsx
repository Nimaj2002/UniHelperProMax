import { FileArrowUp } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { FormError } from "@/components/form/FormError";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useCourseTree, type YearNode } from "@/features/courses/api";
import { usePreferences } from "@/features/sessions/api";
import { cn } from "@/lib/utils";
import {
  applyImport,
  discardUpload,
  MAX_ICS_BYTES,
  problemMessage,
  uploadIcs,
  useRefreshSchedule,
  type ImportGroup,
} from "./api";
import { DestinationPicker } from "./DestinationPicker";
import { GroupTable, skippedLine } from "./GroupTable";
import { ImportResult } from "./ImportResult";
import {
  courseTarget,
  initialState,
  nameKey,
  predictColors,
  reducer,
  selectedCount,
  toPlan,
  usesSaved,
  validate,
  type CourseLite,
  type GroupState,
  type Problem,
} from "./wizardReducer";

function coursesOf(tree: YearNode[], semesterId: string | undefined): CourseLite[] {
  if (!semesterId) return [];
  for (const y of tree) for (const s of y.semesters) if (s.semester.id === semesterId) return s.courses;
  return [];
}

function savedCourses(tree: YearNode[], yearName: string, semesterName: string): CourseLite[] {
  for (const y of tree)
    if (nameKey(y.year.name) === nameKey(yearName))
      for (const s of y.semesters) if (nameKey(s.semester.name) === nameKey(semesterName)) return s.courses;
  return [];
}

function isIcs(file: File): boolean {
  return /\.ics$/i.test(file.name) || file.type === "text/calendar";
}

/** "Import calendar (.ics)" (010 US1, US3–US5): choose → reading → preview (destination +
 * groups) → importing → result. Nothing changes until confirm; reading can be cancelled. */
export function ImportWizard() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const tree = useCourseTree();
  const prefs = usePreferences();
  const refresh = useRefreshSchedule();
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState<Problem>();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const uploadIdRef = useRef<string | undefined>(undefined);
  const lastAnnounced = useRef(-10);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const nodes = useMemo(() => tree.data ?? [], [tree.data]);

  const announce = useCallback((m: string) => setMessage(m), []);

  // leaving the page with a staged preview discards it (nothing was imported)
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (uploadIdRef.current) void discardUpload(uploadIdRef.current).catch(() => undefined);
    },
    [],
  );

  const coursesFor = useCallback(
    (g: ImportGroup, gs: GroupState): CourseLite[] => {
      if (usesSaved(g, gs) && g.saved) return savedCourses(nodes, g.saved.yearName, g.saved.semesterName);
      return state.destination.mode === "existing" ? coursesOf(nodes, state.destination.semesterId) : [];
    },
    [nodes, state.destination],
  );

  const newColors = useMemo(() => {
    const preview = state.preview;
    if (!preview) return {};
    const names: string[] = [];
    for (const g of preview.groups) {
      const gs = state.groups[g.groupId];
      if (!gs?.selected || gs.importAs !== "class" || usesSaved(g, gs)) continue;
      const t = courseTarget(g, gs, coursesFor(g, gs));
      if (t.kind === "new") names.push(t.name);
    }
    const existing = state.destination.mode === "existing" ? coursesOf(nodes, state.destination.semesterId).map((c) => c.defaultColor) : [];
    return predictColors(names, existing);
  }, [state.preview, state.groups, state.destination, nodes, coursesFor]);

  const start = async (file: File) => {
    setProblem(undefined);
    if (!isIcs(file)) {
      dispatch({ type: "failed", message: "Choose a calendar file ending in .ics." });
      return;
    }
    if (file.size > MAX_ICS_BYTES) {
      dispatch({ type: "failed", message: "This file is larger than 5 MB." });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    lastAnnounced.current = -10;
    dispatch({ type: "start", fileName: file.name });
    announce(`Reading ${file.name}`);
    try {
      const preview = await uploadIcs(
        file,
        (loaded, total) => {
          const pct = total ? (loaded / total) * 100 : 0;
          dispatch({ type: "progress", percent: pct });
          if (pct >= 100) {
            dispatch({ type: "checking" });
            announce("Checking file");
          } else if (pct - lastAnnounced.current >= 10) {
            lastAnnounced.current = pct;
            announce(`Reading file, ${Math.floor(pct / 10) * 10}%`);
          }
        },
        controller.signal,
      );
      uploadIdRef.current = preview.uploadId;
      if (controller.signal.aborted) {
        void discardUpload(preview.uploadId).catch(() => undefined);
        return;
      }
      const last = prefs.data?.lastSemesterId ?? undefined;
      const known = !!last && nodes.some((y) => y.semesters.some((s) => s.semester.id === last));
      dispatch({ type: "loaded", preview, semesterId: known ? last : nodes[0]?.semesters[0]?.semester.id });
      announce(`Preview ready: ${preview.groups.length} ${preview.groups.length === 1 ? "group" : "groups"}`);
      requestAnimationFrame(() => previewHeadingRef.current?.focus());
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const m = problemMessage(err);
      dispatch({ type: "failed", message: m });
      announce(m);
    } finally {
      abortRef.current = null;
    }
  };

  const cancelReading = () => {
    abortRef.current?.abort();
    if (uploadIdRef.current) void discardUpload(uploadIdRef.current).catch(() => undefined);
    uploadIdRef.current = undefined;
    dispatch({ type: "reset" });
    announce("Import cancelled");
    requestAnimationFrame(() => document.getElementById("ics-drop")?.focus());
  };

  const cancelPreview = () => {
    if (uploadIdRef.current) void discardUpload(uploadIdRef.current).catch(() => undefined);
    uploadIdRef.current = undefined;
    setProblem(undefined);
    dispatch({ type: "reset" });
    requestAnimationFrame(() => document.getElementById("ics-drop")?.focus());
  };

  const confirm = async () => {
    const found = validate(state, coursesFor);
    setProblem(found);
    if (found) {
      announce(found.message);
      const selector = found.groupId ? `[data-group-id="${found.groupId}"] [aria-invalid="true"], [data-group-id="${found.groupId}"] button, [data-group-id="${found.groupId}"] input` : "#dest-semester-name, [aria-label='Semester']";
      requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
      return;
    }
    const uploadId = state.preview?.uploadId;
    if (!uploadId) return;
    dispatch({ type: "importing" });
    announce("Importing…");
    try {
      const result = await applyImport(uploadId, toPlan(state));
      uploadIdRef.current = undefined;
      dispatch({ type: "imported", result });
      void refresh();
    } catch (err) {
      const m = problemMessage(err);
      dispatch({ type: "importFailed", message: m });
      announce(m);
      if ((err as { code?: string }).code === "upload_expired") uploadIdRef.current = undefined;
      requestAnimationFrame(() => confirmRef.current?.focus());
    }
  };

  const onDone = () => {
    dispatch({ type: "reset" });
    requestAnimationFrame(() => document.getElementById("ics-drop")?.focus());
  };

  const count = selectedCount(state);
  const live = (
    <div role="status" aria-live="polite" className="sr-only" data-testid="import-announcer">
      {message}
    </div>
  );

  if (state.step === "result" && state.result)
    return (
      <>
        {live}
        <ImportResult result={state.result} onDone={onDone} announce={announce} />
      </>
    );

  if (state.step === "preview" || state.step === "importing") {
    const preview = state.preview!;
    const importing = state.step === "importing";
    return (
      <div className="space-y-4">
        {live}
        <h4 ref={previewHeadingRef} tabIndex={-1} className="text-base font-semibold outline-none">
          Preview of {preview.fileName}
        </h4>
        <p className="text-sm text-muted-foreground">
          {preview.eventCount} {preview.eventCount === 1 ? "event" : "events"} in the file. Times are shown in your time zone ({preview.timezone}).
        </p>
        <fieldset disabled={importing} className="space-y-4">
          <DestinationPicker
            tree={nodes}
            value={state.destination}
            onChange={(destination) => dispatch({ type: "setDestination", destination })}
            fromThisApp={preview.fromThisApp}
            invalid={problem?.field === "destination" ? problem.message : undefined}
          />
          <GroupTable
            groups={preview.groups}
            states={state.groups}
            coursesFor={coursesFor}
            newColors={newColors}
            problem={problem}
            dispatch={dispatch}
          />
          {preview.skipped.length > 0 && (
            <details className="rounded-md border border-divider px-3 py-2 text-sm">
              <summary className="cursor-pointer">Not imported ({preview.skipped.length})</summary>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {preview.skipped.map((s, i) => (
                  <li key={i}>{skippedLine(s)}</li>
                ))}
              </ul>
            </details>
          )}
        </fieldset>
        <FormError message={state.error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button ref={confirmRef} onClick={confirm} disabled={importing || count === 0}>
            {importing ? "Importing…" : `Import ${count} ${count === 1 ? "entry" : "entries"}`}
          </Button>
          <Button variant="outline" onClick={cancelPreview} disabled={importing}>
            Cancel
          </Button>
          {problem && !importing && <p className="text-sm text-danger">{problem.message}</p>}
          {count === 0 && <p className="text-sm text-muted-foreground">Select at least one group to import.</p>}
        </div>
      </div>
    );
  }

  if (state.step === "reading")
    return (
      <div className="space-y-3">
        {live}
        <p className="text-sm font-medium">{state.fileName}</p>
        <Progress value={state.percent} aria-label={`Reading ${state.fileName}`} className="max-w-md" />
        <p className="text-sm text-muted-foreground">{state.checking ? "Checking…" : `Uploading ${state.percent}%`}</p>
        <Button variant="outline" onClick={cancelReading}>
          Cancel
        </Button>
      </div>
    );

  return (
    <div className="space-y-3">
      {live}
      <div
        id="ics-drop"
        role="button"
        tabIndex={0}
        aria-label="Choose .ics file"
        aria-describedby="ics-limits"
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-divider px-4 py-8 text-center",
          "hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          dragging && "border-ring bg-accent",
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length !== 1) {
            dispatch({ type: "failed", message: "Drop one .ics file at a time." });
            return;
          }
          void start(files[0]);
        }}
      >
        <FileArrowUp size={28} aria-hidden className="text-muted-foreground" />
        <span className="font-medium">Import calendar (.ics)</span>
        <span className="text-sm text-muted-foreground">Drop a file here or press to choose one</span>
      </div>
      <p id="ics-limits" className="text-xs text-muted-foreground">
        Up to 5 MB and 5,000 events.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".ics,text/calendar"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="ics-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void start(file);
        }}
      />
      <FormError message={state.error} />
    </div>
  );
}
