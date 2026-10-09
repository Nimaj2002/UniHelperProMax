import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { importQueue, type AnyQueue } from "./importQueue";

function hasFiles(e: DragEvent) {
  return [...e.dataTransfer.types].includes("Files");
}

interface DropZoneProps {
  sessionKey: string;
  queue: AnyQueue;
  label: string;
  testId: string;
  children: ReactNode;
}

/** Dropping files anywhere on the zone uploads them like its upload button (006, 007). */
export function FileDropZone({ sessionKey, queue, label, testId, children }: DropZoneProps) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    const files: File[] = [];
    let folders = 0;
    const items = [...e.dataTransfer.items];
    items.forEach((item, i) => {
      if (item.kind !== "file") return;
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        folders += 1;
        return;
      }
      const f = item.getAsFile() ?? e.dataTransfer.files[i];
      if (f) files.push(f);
    });
    if (!items.length) files.push(...e.dataTransfer.files);
    if (folders) toast.warning("Folders can't be uploaded — drop the files inside.");
    if (files.length) queue.enqueue(sessionKey, files);
  };

  return (
    <div
      className="relative min-w-0"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={onDrop}
      data-testid={testId}
    >
      {children}
      {over && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border-2 border-dashed border-primary bg-background/90 p-4 text-center text-sm font-medium text-foreground"
        >
          {label}
        </div>
      )}
    </div>
  );
}

/** Dropping audio anywhere on the panel uploads it like "Upload audio" (006 US1 #3). */
export function AudioDropZone({ sessionKey, children }: { sessionKey: string; children: ReactNode }) {
  return (
    <FileDropZone sessionKey={sessionKey} queue={importQueue()} label="Drop audio files to upload" testId="audio-drop-zone">
      {children}
    </FileDropZone>
  );
}
