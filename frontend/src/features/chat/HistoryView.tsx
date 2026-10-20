/**
 * 014 US4 FR-025/FR-026 (contracts/ui-contract.md "History view"): the session's chats, newest
 * first — one-line titles (the full title on hover and focus), relative ages, Generating and
 * "Open in tab" badges, a menu with Rename and Delete (Undo for 10 s), five chats then "More (N)",
 * and a search of the titles or, with "Search in messages", of the messages' text (FR-062) with
 * the matching snippet.
 */
import { CircleNotch, DotsThree, MagnifyingGlass } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { chatsOfSession, deleteChatFresh, restoreChat, updateChatFresh, useChats, type ChatSummary } from "./api";
import { useGeneratingChats } from "./runStore";

export const HISTORY_SHOWN = 5;
export const UNDO_MS = 10_000;
const SEARCH_DEBOUNCE_MS = 200;

function age(iso: string): { rel: string; exact: string } {
  try {
    const d = parseISO(iso);
    return { rel: formatDistanceToNow(d, { addSuffix: true }), exact: format(d, "EEE d MMM yyyy, HH:mm") };
  } catch {
    return { rel: "", exact: iso };
  }
}

interface ItemProps {
  chat: ChatSummary;
  /** The text around a match in the messages (search in messages). */
  match?: string | null;
  generating: boolean;
  inTab: boolean;
  onOpen: (id: string) => void;
  onRename: (chat: ChatSummary, title: string) => Promise<void>;
  onDelete: (chat: ChatSummary) => void;
}

const HistoryItem = memo(function HistoryItem({ chat, match, generating, inTab, onOpen, onRename, onDelete }: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(chat.title);
  const input = useRef<HTMLInputElement>(null);
  const openBtn = useRef<HTMLButtonElement>(null);
  // a renamed chat moves to the top of the list, and moving a focused button drops focus:
  // keep it on the chat until the refreshed list has settled
  const refocus = useRef(false);
  const when = age(chat.updatedAt);

  useEffect(() => {
    if (!refocus.current || editing) return;
    openBtn.current?.focus();
    if (chat.title === value.trim()) refocus.current = false;
  }, [chat.title, chat.updatedAt, editing, value]);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const finish = async (save: boolean) => {
    const title = value.trim();
    if (save && title && title !== chat.title) {
      try {
        await onRename(chat, title);
      } catch {
        return; // the error toast is shown; keep editing
      }
    }
    refocus.current = save && title !== "" && title !== chat.title;
    setEditing(false);
    requestAnimationFrame(() => openBtn.current?.focus());
  };

  return (
    <li className="group relative flex min-w-0 items-start gap-1 rounded-md pr-1 hover:bg-surface-hover focus-within:bg-surface-hover">
      {editing ? (
        <input
          ref={input}
          aria-label="Chat title"
          value={value}
          maxLength={200}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void finish(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setValue(chat.title);
              void finish(false);
            }
          }}
          onBlur={() => void finish(true)}
          className="m-1 h-8 min-w-0 flex-1 rounded border border-input bg-surface px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <button
          ref={openBtn}
          type="button"
          aria-label={chat.title}
          title={chat.title}
          onClick={() => onOpen(chat.id)}
          className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left"
        >
          <span className="w-full truncate text-sm text-foreground">{chat.title}</span>
          {match && (
            <span className="line-clamp-2 w-full text-xs break-words text-muted-foreground" data-testid="chat-match">
              {match}
            </span>
          )}
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <time dateTime={chat.updatedAt} title={when.exact}>
              {when.rel}
            </time>
            {generating && (
              <span className="inline-flex items-center gap-1 rounded-full border border-divider px-1.5 leading-4">
                <CircleNotch size={10} aria-hidden className="animate-spin motion-reduce:animate-none" />
                Generating
              </span>
            )}
            {inTab && <span className="rounded-full border border-divider px-1.5 leading-4">Open in tab</span>}
          </span>
        </button>
      )}
      {!editing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Chat actions"
              className="mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-surface-sunken hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <DotsThree size={18} weight="bold" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setValue(chat.title);
                setEditing(true);
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(chat)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
});

interface Props {
  sessionKey: string;
  /** The search box shows (toggled by the header's "Search chats"). */
  searching: boolean;
  onCloseSearch: () => void;
  onOpen: (chatId: string) => void;
  /** Chats open in a workspace tab ("Open in tab"). */
  inTabs: string[];
  /** A chat was deleted (the panel or a tab may show it). */
  onDeleted?: (chatId: string) => void;
}

export function HistoryView({ sessionKey, searching, onCloseSearch, onOpen, inTabs, onDeleted }: Props) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const [inText, setInText] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const generatingNow = useGeneratingChats();

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (searching) search.current?.focus();
  }, [searching]);

  const filter = searching ? query : "";
  const chats = useChats(sessionKey, filter, inText ? "text" : "title");
  const list = chats.data ?? [];
  const shown = all || filter ? list : list.slice(0, HISTORY_SHOWN);
  const more = list.length - shown.length;

  const refresh = () => void qc.invalidateQueries({ queryKey: chatsOfSession(sessionKey) });

  const rename = async (chat: ChatSummary, title: string) => {
    try {
      await updateChatFresh(chat.id, chat.version, { title });
      refresh();
      void qc.invalidateQueries({ queryKey: ["chat", chat.id] });
    } catch (err) {
      toast.error(isApiError(err, "version_conflict") ? "The chat changed meanwhile. Try again." : "Couldn't rename the chat.");
      refresh();
      throw err;
    }
  };

  const remove = (chat: ChatSummary) => {
    void deleteChatFresh(chat.id, chat.version).then(
      () => {
        qc.setQueriesData<ChatSummary[]>({ queryKey: chatsOfSession(sessionKey) }, (l) => l?.filter((c) => c.id !== chat.id));
        refresh();
        onDeleted?.(chat.id);
        toast("Chat deleted", {
          duration: UNDO_MS,
          action: {
            label: "Undo",
            onClick: () =>
              void restoreChat(chat.id).then(refresh, (err) =>
                toast.error(isApiError(err, "undo_expired") ? "This chat can no longer be restored." : "Couldn't restore the chat."),
              ),
          },
        });
      },
      () => {
        toast.error("Couldn't delete the chat.");
        refresh();
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {searching && (
        <div className="relative shrink-0 px-2 pt-2">
          <MagnifyingGlass size={14} aria-hidden className="absolute top-1/2 left-4 mt-1 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={search}
            type="search"
            role="searchbox"
            aria-label="Search chats"
            placeholder={inText ? "Search chat messages" : "Search chat titles"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCloseSearch();
              }
            }}
            className="h-8 w-full rounded-md border border-input bg-transparent pr-2 pl-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-1.5 flex w-fit items-center gap-2 text-xs text-muted-foreground">
            <Switch id={`${sessionKey}-search-in-text`} size="sm" checked={inText} onCheckedChange={setInText} />
            <label htmlFor={`${sessionKey}-search-in-text`}>Search in messages</label>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {chats.isPending ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">Loading chats…</p>
        ) : chats.isError ? (
          <p role="alert" className="px-2 py-2 text-sm text-danger">
            Couldn't load the chats.
          </p>
        ) : !list.length ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">
            {filter ? (inText ? "No chat messages match." : "No chat titles match.") : "No chats in this session yet. Ask a question below to start one."}
          </p>
        ) : null}
        {list.length > 0 && (
          <ul aria-label="Chats" className="grid gap-0.5">
            {shown.map((c) => (
              <HistoryItem
                key={c.id}
                chat={c}
                match={filter && inText ? c.match : undefined}
                generating={c.generating || generatingNow.has(c.id)}
                inTab={inTabs.includes(c.id)}
                onOpen={onOpen}
                onRename={rename}
                onDelete={remove}
              />
            ))}
          </ul>
        )}
        {more > 0 && (
          <button
            type="button"
            onClick={() => setAll(true)}
            aria-label={`More (${more})`}
            className={cn("mt-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground")}
          >
            <span>More</span>
            <span className="tabular-nums">{more}</span>
          </button>
        )}
      </div>
    </div>
  );
}
