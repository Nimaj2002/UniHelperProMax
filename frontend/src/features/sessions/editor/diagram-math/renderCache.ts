import { readLocal, writeLocal } from "@/lib/storage";

/** A small least-recently-used map. */
export class LruCache<K, V> {
  private map = new Map<K, V>();

  constructor(private readonly limit: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as K);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------- reserved heights (FR-023)

const HEIGHTS_KEY = "uh.diagramHeights";
const HEIGHTS_LIMIT = 500;
export const DEFAULT_DIAGRAM_HEIGHT = 240;

let heights: Record<string, number> | null = null;

function loadHeights(): Record<string, number> {
  heights ??= readLocal<Record<string, number>>(HEIGHTS_KEY, {});
  return heights;
}

/** The space to keep for a diagram before it is drawn: its last drawn height, or 240 px. */
export function reservedHeight(sourceHash: string): number {
  return loadHeights()[sourceHash] ?? DEFAULT_DIAGRAM_HEIGHT;
}

export function rememberHeight(sourceHash: string, height: number): void {
  const all = loadHeights();
  if (all[sourceHash] === height) return;
  delete all[sourceHash];
  all[sourceHash] = Math.round(height);
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - HEIGHTS_LIMIT))) delete all[k];
  writeLocal(HEIGHTS_KEY, all);
}
