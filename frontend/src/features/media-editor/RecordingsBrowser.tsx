import { FileAudio, MagnifyingGlass } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { File, Folder, Tree } from "@/components/ui/file-tree";
import { Input } from "@/components/ui/input";
import { formatDuration } from "@/features/recordings/format";
import { cn } from "@/lib/utils";
import { useMediaTree, type MediaClassGroup } from "./api";

interface Props {
  currentId: string | null;
  onPick: (id: string) => void;
}

const classId = (g: MediaClassGroup) => `c:${g.id ?? "events"}${g.context}`;
const sessionId = (g: MediaClassGroup, key: string) => `s:${classId(g)}/${key}`;

/**
 * The recordings as a file tree (Magic UI File Tree), class → session → audio (025 FR-004a–d):
 * pick any audio to edit without going back to the session. The current audio's class and session
 * are open; a filter narrows by name and opens every match.
 */
export function RecordingsBrowser({ currentId, onPick }: Props) {
  const tree = useMediaTree();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!tree.data) return [];
    if (!q) return tree.data;
    return tree.data
      .map((g) => ({
        ...g,
        sessions: g.sessions
          .map((s) => ({ ...s, recordings: s.recordings.filter((r) => r.name.toLowerCase().includes(q)) }))
          .filter((s) => s.recordings.length),
      }))
      .filter((g) => g.sessions.length);
  }, [tree.data, q]);

  // what starts open: everything while filtering, else the folders holding the current audio
  const expanded = groups.flatMap((g) =>
    g.sessions.flatMap((s) =>
      q || s.recordings.some((r) => r.id === currentId) ? [classId(g), sessionId(g, s.sessionKey)] : [],
    ),
  );

  return (
    <nav aria-label="Recordings" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="relative">
        <MagnifyingGlass size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter recordings" aria-label="Filter recordings by name" className="h-8 pl-8" />
      </div>
      <div className="min-h-0 flex-1">
        {tree.isPending && <p className="p-2 text-sm text-muted-foreground">Loading recordings…</p>}
        {tree.isError && (
          <p role="alert" className="p-2 text-sm text-danger">
            Couldn't load recordings.
          </p>
        )}
        {tree.data && groups.length === 0 && (
          <p className="p-2 text-sm text-muted-foreground">{q ? "No recordings match." : "No recordings yet. Record or import audio in a session."}</p>
        )}
        {groups.length > 0 && (
          <Tree
            key={q ? `filter:${q}` : "all"}
            className="[&_[data-radix-scroll-area-viewport]>div]:block!"
            initialExpandedItems={expanded}
            sort="none"
          >
            {groups.map((g) => (
              <Folder
                key={classId(g)}
                value={classId(g)}
                isSelect={false}
                element={
                  <>
                    <span className="font-medium">{g.name}</span>
                    {g.context && <span className="ml-1.5 text-xs text-muted-foreground">{g.context}</span>}
                  </>
                }
              >
                {g.sessions.map((s) => (
                  <Folder
                    key={sessionId(g, s.sessionKey)}
                    value={sessionId(g, s.sessionKey)}
                    isSelect={false}
                    element={
                      <>
                        {s.title}
                        <span className="ml-1.5 font-mono text-xs tabular-nums text-muted-foreground">{s.date}</span>
                      </>
                    }
                  >
                    {s.recordings.map((r) => (
                      <File
                        key={r.id}
                        value={`r:${r.id}`}
                        isSelect={r.id === currentId}
                        isSelectable={!r.missing}
                        fileIcon={<FileAudio size={16} aria-hidden />}
                        aria-current={r.id === currentId ? "true" : undefined}
                        handleSelect={() => onPick(r.id)}
                        className={cn("w-full justify-between gap-2 py-1 pl-1 hover:bg-accent", r.id === currentId && "font-medium")}
                      >
                        <span className="min-w-0 flex-1 truncate text-left">{r.name}</span>
                        <span className={cn("shrink-0 font-mono text-xs tabular-nums", r.id === currentId ? "text-foreground" : "text-muted-foreground")}>
                          {r.missing ? "missing" : formatDuration(r.durationMs)}
                        </span>
                      </File>
                    ))}
                  </Folder>
                ))}
              </Folder>
            ))}
          </Tree>
        )}
      </div>
    </nav>
  );
}
