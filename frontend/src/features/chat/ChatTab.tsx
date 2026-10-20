/**
 * 014 US5 FR-043: a chat in a workspace tab — the same views as the panel, centred at a reading
 * width, plus "Dock chat to the panel". The tab's id is the chat's (a `new:<uuid>` id until its
 * first message is sent).
 */
import { MagnifyingGlass, SidebarSimple } from "@phosphor-icons/react";
import { isNewChatId, newChatId } from "./api";
import { HeaderButton } from "./ChatSection";
import { ChatBody } from "./ChatSection";
import { setSearchOpen, useChatPlacement, useSearchOpen } from "./chatPlacement";

interface Props {
  sessionKey: string;
  tabId: string;
}

export function ChatTab({ sessionKey, tabId }: Props) {
  const place = useChatPlacement(sessionKey);
  const searchPlace = `tab:${tabId}`;
  const searching = useSearchOpen(searchPlace);
  const isNew = isNewChatId(tabId);
  const dock = (
    <HeaderButton label="Dock chat to the panel" onClick={() => place({ type: "dock", tabId })}>
      <SidebarSimple size={18} aria-hidden className="-scale-x-100" />
    </HeaderButton>
  );
  const show = (id: string) => place({ type: "sent", from: tabId, to: id });
  return (
    <div className="flex h-full min-h-0 justify-center bg-editor-surface">
      <div className="flex h-full min-h-0 w-full max-w-[72ch] flex-col">
        {isNew && (
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-divider px-1">
            <h2 className="min-w-0 flex-1 truncate px-2 text-sm font-medium">Chats</h2>
            <HeaderButton label="Search chats" pressed={searching} onClick={() => setSearchOpen(searchPlace, !searching)}>
              <MagnifyingGlass size={18} aria-hidden />
            </HeaderButton>
            {dock}
          </div>
        )}
        <ChatBody
          sessionKey={sessionKey}
          place={{ place: "tab", id: tabId }}
          view={isNew ? "history" : "conversation"}
          chatId={isNew ? null : tabId}
          onOpen={(id) => {
            setSearchOpen(searchPlace, false);
            show(id);
          }}
          onBack={() => show(newChatId())}
          onNewChat={() => show(newChatId())}
          onStarted={show}
          conversationActions={dock}
          searching={searching}
          onCloseSearch={() => setSearchOpen(searchPlace, false)}
          onDeleted={(id) => place({ type: "retain", valid: (c) => c !== id })}
        />
      </div>
    </div>
  );
}
