/** Side-by-side layout for overlapping sessions (FR-010). Pure function. */
export interface Interval {
  key: string;
  start: number; // minutes since midnight
  end: number;
}

export interface Placement {
  column: number;
  columns: number;
}

export function layoutOverlaps(items: Interval[]): Map<string, Placement> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end || a.key.localeCompare(b.key));
  const result = new Map<string, Placement>();
  let cluster: { key: string; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const columns = columnEnds.length;
    for (const { key, column } of cluster) result.set(key, { column, columns });
    cluster = [];
    columnEnds = [];
  };

  for (const it of sorted) {
    if (it.start >= clusterEnd) flush(); // touching (end == start) is not an overlap
    let column = columnEnds.findIndex((end) => end <= it.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(it.end);
    } else {
      columnEnds[column] = it.end;
    }
    cluster.push({ key: it.key, column });
    clusterEnd = Math.max(clusterEnd === -Infinity ? it.end : clusterEnd, it.end);
  }
  flush();
  return result;
}
