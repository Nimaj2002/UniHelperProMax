/**
 * 022 US1/US5 (contracts/ui-contract.md "Session panel"): the AI Teacher section — this session's
 * lessons and practice chats, newest first, and New chat (Lesson or Practice). Each chat opens in
 * a workspace tab; its menu renames or deletes it (the confirmation says how many knowledge-graph
 * ideas go with it).
 */
import { DotsThree, GraduationCap, Plus } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useModels } from "@/features/chat/models";
import { useGeneratingChats } from "@/features/chat/runStore";
import {
  deleteTeacherChat,
  graphImpact,
  newTeacherId,
  renameTeacherChat,
  restoreTeacherChat,
  teacherListKey,
  useTeacherChats,
  withFreshVersion,
  type TeacherKind,
  type TeacherSummary,
} from "./api";
import { useTeacherTabsHost } from "./teacherTabs";

const when = (iso: string) => {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return "";
  }
};

/** New chat → Lesson / Practice, in the section's title row. */
export function TeacherSectionActions({ sessionKey }: { sessionKey: string }) {
  const host = useTeacherTabsHost();
  const models = useModels();
  const ready = !models.loading && models.choices.length > 0;
  const open = (kind: TeacherKind) => host?.sessionKey === sessionKey && host.open(newTeacherId(kind));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="New teacher chat"
          title={ready ? "New chat" : "Add an AI model in Settings → AI first"}
          disabled={!ready}
          aria-describedby={ready ? undefined : "teacher-setup-hint"}
        >
          <Plus size={18} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => open("lesson")}>New lesson</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open("practice")}>New practice</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({ chat, generating, onOpen, onRename, onDelete }: {
  chat: TeacherSummary;
  generating: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group flex min-w-0 items-center gap-1 rounded-md hover:bg-surface-hover">
      <button
        type="button"
        onClick={onOpen}
        title={chat.title}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat.title}</span>
          {(chat.unseenAnswer || generating) && (
            <span className="size-2 shrink-0 rounded-full bg-primary" aria-label={generating ? "Answering" : "New reply"} />
          )}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted group-hover:text-foreground">
          <Badge variant="outline" className="h-4 px-1 text-[11px]">
            {chat.kind === "lesson" ? "Lesson" : "Practice"}
          </Badge>
          <span>{when(chat.updatedAt)}</span>
          {chat.unansweredCount > 0 && <span>· {chat.unansweredCount} open</span>}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`Actions for ${chat.title}`}>
            <DotsThree size={16} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete} className="text-destructive">
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function TeacherSection({ sessionKey }: { sessionKey: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const models = useModels();
  const chats = useTeacherChats(sessionKey);
  const host = useTeacherTabsHost();
  const generating = useGeneratingChats();
  const [renaming, setRenaming] = useState<{ chat: TeacherSummary; title: string } | null>(null);
  const [deleting, setDeleting] = useState<{ chat: TeacherSummary; ideas: number } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: teacherListKey(sessionKey) });

  if (!models.loading && !models.choices.length)
    return (
      <div className="grid flex-1 content-center justify-items-center gap-3 p-4 text-center">
        <GraduationCap size={28} aria-hidden className="text-text-muted" />
        <p id="teacher-setup-hint" className="max-w-64 text-sm text-text-muted">
          The AI teacher uses the models you add in Settings → AI. Add an endpoint with at least one model to start a lesson.
        </p>
        <Button size="sm" onClick={() => navigate("/settings/ai")}>
          Open AI settings
        </Button>
      </div>
    );

  const list = chats.data ?? [];
  const rename = async () => {
    if (!renaming) return;
    const { chat, title } = renaming;
    setRenaming(null);
    try {
      await withFreshVersion(sessionKey, chat.id, chat.version, (v) => renameTeacherChat(chat.id, v, title.trim()));
    } catch {
      toast.error("Couldn't rename the chat. Try again.");
    }
    void refresh();
  };
  const askDelete = async (chat: TeacherSummary) => {
    const ideas = await graphImpact(chat.id).then((r) => r.ideas, () => 0);
    setDeleting({ chat, ideas });
  };
  const remove = async () => {
    if (!deleting) return;
    const { chat } = deleting;
    setDeleting(null);
    try {
      await withFreshVersion(sessionKey, chat.id, chat.version, (v) => deleteTeacherChat(chat.id, v));
      host?.close(chat.id);
      toast("Chat deleted", {
        action: { label: "Undo", onClick: () => void restoreTeacherChat(chat.id).then(refresh) },
      });
    } catch {
      toast.error("Couldn't delete the chat. Try again.");
    }
    void refresh();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5">
      {chats.isPending ? (
        <p className="p-3 text-sm text-text-muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="p-3 text-sm text-text-muted">
          No lessons yet. Use + to start a lesson: tell the teacher what you want to understand.
        </p>
      ) : (
        <ul aria-label="Teacher chats" className="grid gap-0.5">
          {list.map((c) => (
            <Row
              key={c.id}
              chat={c}
              generating={generating.has(c.id)}
              onOpen={() => host?.open(c.id)}
              onRename={() => setRenaming({ chat: c, title: c.title })}
              onDelete={() => void askDelete(c)}
            />
          ))}
        </ul>
      )}

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
            className="grid gap-2"
          >
            <Label htmlFor="teacher-rename">Title</Label>
            <Input
              id="teacher-rename"
              value={renaming?.title ?? ""}
              maxLength={200}
              onChange={(e) => setRenaming((r) => r && { ...r, title: e.target.value })}
            />
            <DialogFooter>
              <Button type="submit" disabled={!renaming?.title.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.chat.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its messages, questions and answers are deleted.
              {deleting && deleting.ideas > 0 &&
                ` ${deleting.ideas} ${deleting.ideas === 1 ? "idea" : "ideas"} will be removed from your knowledge graph.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
