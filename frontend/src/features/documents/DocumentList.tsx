import { CaretRight, DotsThree, FilePdf } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { File } from "@/components/ui/file-tree";
import { useSession } from "@/features/classes/api";
import { FileDropZone } from "@/features/imports/AudioDropZone";
import { formatBytes } from "@/features/imports/audioFiles";
import { UploadList } from "@/features/imports/UploadList";
import { AddCircleButton, FileTreeList } from "@/features/sessions/FileTreeList";
import type { SidePanelSectionProps } from "@/features/sessions/workspace-panels";
import { formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  allDocumentsKey,
  deleteDocument,
  documentKey,
  documentsKey,
  hideDocument,
  prefetchReader,
  renameDocument,
  showDocument,
  useDocuments,
  useHiddenDocuments,
  type Document,
} from "./api";
import { DeleteDocumentDialog, RenameDocumentDialog } from "./DocumentDialogs";
import { PDF_ACCEPT } from "./pdfFiles";
import { documentQueue } from "./queue";

function uploadedOn(iso: string) {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return formatDay(date, "d MMM");
}

/** The day of a session from its key (`{lineageId}:{yyyy-mm-dd}`). */
function sessionDay(key: string) {
  return formatDay(key.slice(key.lastIndexOf(":") + 1), "d MMM");
}

/**
 * "Documents" in the session's side panel (007 FR-001–FR-010): upload, list, open, rename, delete.
 * Lists the documents of every session of the course; one uploaded to another session says which.
 * A PDF is renamed or deleted only in the session it was uploaded to; elsewhere it can only be
 * hidden from this session's list (017).
 */
export function DocumentList({ sessionKey, openDocument, closeDocument }: SidePanelSectionProps) {
  const docs = useDocuments(sessionKey);
  const session = useSession(sessionKey);
  const hidden = useHiddenDocuments(sessionKey);
  const hiddenList = hidden.data ?? [];
  const [showHidden, setShowHidden] = useState(false);
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const queue = documentQueue();
  const list = docs.data ?? [];
  const [dialog, setDialog] = useState<{ kind: "rename" | "delete"; doc: Document } | null>(null);
  const onRename = (doc: Document) => setDialog({ kind: "rename", doc });
  const onDelete = (doc: Document) => setDialog({ kind: "delete", doc });
  // every session of the course lists the document
  const refresh = () => qc.invalidateQueries({ queryKey: allDocumentsKey });
  // only this session's lists change (documentsKey covers the hidden list too)
  const refreshHere = () => qc.invalidateQueries({ queryKey: documentsKey(sessionKey) });
  const onShow = async (doc: Document) => {
    try {
      await showDocument(sessionKey, doc.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
    await refreshHere();
  };
  const onRemove = async (doc: Document) => {
    try {
      await hideDocument(sessionKey, doc.id);
    } catch (err) {
      toast.error((err as Error).message);
      await refresh();
      return;
    }
    closeDocument(doc.id);
    await refreshHere();
    toast.success(`Removed “${doc.name}” from this and later sessions.`, { action: { label: "Undo", onClick: () => void onShow(doc) } });
  };
  const hasDocuments = list.length > 0;
  useEffect(() => {
    if (hasDocuments) prefetchReader();
  }, [hasDocuments]);
  return (
    <>
      {dialog?.kind === "rename" && (
        <RenameDocumentDialog
          doc={dialog.doc}
          others={list.filter((d) => d.id !== dialog.doc.id).map((d) => d.name)}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const renamed = await renameDocument(dialog.doc.id, dialog.doc.version, name, sessionKey).catch(async (err) => {
              await refresh();
              throw err;
            });
            qc.setQueryData(documentKey(renamed.id), renamed);
            await refresh();
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDocumentDialog
          doc={dialog.doc}
          scope={session.data?.kind === "event" ? "event" : "course"}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await deleteDocument(dialog.doc.id, dialog.doc.version, sessionKey).catch(async (err) => {
              await refresh();
              throw err;
            });
            closeDocument(dialog.doc.id);
            qc.removeQueries({ queryKey: documentKey(dialog.doc.id) });
            await refresh();
            setDialog(null);
            toast.success(`Deleted “${dialog.doc.name}”.`);
          }}
        />
      )}
      <FileDropZone sessionKey={sessionKey} queue={queue} label="Drop PDF files to add them" testId="documents-drop-zone">
        <div className="grid gap-2">
          <div className="flex justify-end px-2">
            <AddCircleButton label="Upload a PDF" data-tour="upload-document" onClick={() => input.current?.click()} />
            <input
              ref={input}
              type="file"
              multiple
              accept={PDF_ACCEPT}
              className="hidden"
              tabIndex={-1}
              aria-hidden
              data-testid="upload-pdf-input"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length) queue.enqueue(sessionKey, files);
              }}
            />
          </div>
          <div className="px-2">
            <UploadList sessionKey={sessionKey} queue={queue} />
          </div>
          {docs.isPending && <p className="px-2 text-sm text-muted-foreground">Loading…</p>}
          {docs.isSuccess && list.length === 0 && <p className="px-2 text-sm text-muted-foreground">No documents yet.</p>}
          {list.length > 0 && (
            <FileTreeList label="PDFs" count={list.length} tall>
              {list.map((d) => (
                <div key={d.id} className="group flex items-center gap-0.5">
                  <File
                    value={d.id}
                    fileIcon={<FilePdf size={16} aria-hidden />}
                    handleSelect={() => openDocument(d.id)}
                    title={d.name}
                    className="w-full min-w-0 flex-1 py-1 pl-1 hover:bg-accent"
                  >
                    <span className="grid min-w-0 flex-1 text-left">
                      <span className="truncate">{d.name}</span>
                      <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {formatBytes(d.size)} · {uploadedOn(d.uploadedAt)}
                        {d.sessionKey !== sessionKey && <span>· from {sessionDay(d.sessionKey)}</span>}
                        {d.missing && <Badge variant="outline">File missing</Badge>}
                        {d.encrypted && <Badge variant="outline">Protected</Badge>}
                      </span>
                    </span>
                  </File>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-70 hover:opacity-100" aria-label={`Actions for ${d.name}`}>
                        <DotsThree size={18} weight="bold" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {d.sessionKey === sessionKey ? (
                        <>
                          <DropdownMenuItem onSelect={() => onRename(d)}>Rename…</DropdownMenuItem>
                          <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => onDelete(d)}>
                            Delete…
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <DropdownMenuItem onSelect={() => void onRemove(d)}>Remove from this and later sessions</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </FileTreeList>
          )}
          {hiddenList.length > 0 && (
            <div className="grid gap-0.5 px-1">
              <button
                type="button"
                aria-expanded={showHidden}
                aria-controls={`removed-documents-${sessionKey}`}
                onClick={() => setShowHidden((v) => !v)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <CaretRight size={12} aria-hidden className={cn("shrink-0 transition-transform motion-reduce:transition-none", showHidden && "rotate-90")} />
                Removed from this session ({hiddenList.length})
              </button>
              {showHidden && (
                <ul id={`removed-documents-${sessionKey}`} className="grid gap-0.5">
                  {hiddenList.map((d) => (
                    <li key={d.id} className="flex items-center gap-1 px-2 py-1">
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate text-sm text-muted-foreground" title={d.name}>
                          {d.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(d.size)} · from {sessionDay(d.sessionKey)}
                        </span>
                      </span>
                      <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" aria-label={`Show again: ${d.name}`} onClick={() => void onShow(d)}>
                        Show again
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </FileDropZone>
    </>
  );
}
