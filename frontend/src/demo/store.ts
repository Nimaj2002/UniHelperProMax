/**
 * 024: the demo's in-memory "server" state (data-model.md). One store per tab, rebuilt from the
 * seed on every page load; nothing is persisted.
 *
 * The core store holds the calendar tree, the account and the trash. Each feature group
 * (notes, documents, chat, tasks, …) keeps its own state in its own module and plugs in through
 * `registerSlice`: it is re-seeded on reset and told when sessions are deleted (cascade), so
 * group modules never have to edit this file.
 */
import type { Schemas } from "@/lib/api";

export type Color = Schemas["Course"]["defaultColor"];
export type Recurrence = Schemas["Recurrence"];
export type Link = Schemas["Link"];

/** One class or event series (a lineage has exactly one series in the demo). */
export interface Series {
  kind: "class" | "event";
  id: string;
  lineageId: string;
  courseId: string | null;
  semesterId: string;
  title: string | null;
  location: string | null;
  color: Color;
  startDate: string;
  startTime: string;
  endTime: string;
  links: Link[];
  recurrence: Recurrence;
  version: number;
}

/** A per-occurrence change ("this" scope edits and single-occurrence deletes). */
export interface Override {
  date?: string;
  startTime?: string;
  endTime?: string;
  title?: string | null;
  location?: string | null;
  color?: Color;
  deleted?: boolean;
  version: number;
}

export interface TrashEntry {
  out: Schemas["TrashEntryOut"];
  restore: () => Schemas["RestoreResult"];
}

export interface DemoStore {
  now: Date;
  timeZone: string;
  me: Schemas["Me"];
  preferences: Schemas["Preferences"];
  years: Schemas["Year"][];
  semesters: Schemas["Semester"][];
  courses: Schemas["Course"][];
  series: Series[];
  overrides: Record<string, Override>; // by session key
  trash: TrashEntry[];
  nextId: number;
}

export interface SeedContext {
  now: Date;
  timeZone: string;
}

/** What each feature group contributes to the core store. */
export interface Slice {
  name: string;
  /** Rebuild this group's state; called after the core store is seeded. */
  seed: (store: DemoStore, ctx: SeedContext) => void;
  /** Sessions are gone (series/course/semester/year deleted): drop or hide their items. */
  removeSessions?: (keys: Set<string>, lineageIds: Set<string>) => void;
  /** Counts for deletion-impact answers, for items attached to these sessions/lineages. */
  count?: (keys: Set<string>, lineageIds: Set<string>) => Partial<Record<"notes" | "recordings" | "documents" | "chats" | "teacherChats" | "graphIdeas" | "linkedTaskCount" | "taskCount", number>>;
  /** The task linked to this occurrence, if this group owns tasks (SessionOut.taskId). */
  taskFor?: (key: string) => string | null;
  /** Snapshot this group's items for the given lineages so a trash restore can bring them back. */
  snapshot?: (lineageIds: Set<string>) => () => void;
}

const slices: Slice[] = [];
let store: DemoStore | null = null;

export function registerSlice(slice: Slice): void {
  const i = slices.findIndex((s) => s.name === slice.name);
  if (i >= 0) slices[i] = slice;
  else slices.push(slice);
}

export function getSlices(): readonly Slice[] {
  return slices;
}

export function getStore(): DemoStore {
  if (!store) throw new Error("demo store not initialised");
  return store;
}

/** Replace the store with a fresh seed and re-seed every slice. */
export function resetStore(core: DemoStore): DemoStore {
  store = core;
  const ctx = { now: core.now, timeZone: core.timeZone };
  for (const s of slices) s.seed(core, ctx);
  return core;
}

export function newId(prefix = "demo"): string {
  const s = getStore();
  s.nextId += 1;
  return `${prefix}-${s.nextId}`;
}

export function bump<T extends { version: number }>(item: T): T {
  item.version += 1;
  return item;
}

export function nowIso(): string {
  return new Date().toISOString();
}
