import { SidebarSimple, SignOut, UserCircle } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLogout, useMe } from "@/features/auth/api";
import { useAccountMenuItems, useTopBarActions } from "./registry";
import { useToolbarNode } from "./toolbar";

export function TopBar({ panelVisible, onTogglePanel }: { panelVisible: boolean; onTogglePanel: () => void }) {
  const toolbar = useToolbarNode();
  const actions = useTopBarActions();
  const accountItems = useAccountMenuItems();
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <header className="flex h-14 min-w-0 items-center gap-1 border-b border-divider bg-surface px-1.5 sm:gap-2 sm:px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onTogglePanel}
            aria-controls="course-panel"
            aria-expanded={panelVisible}
            aria-label={panelVisible ? "Hide course panel" : "Show course panel"}
          >
            <SidebarSimple size={20} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {panelVisible ? "Hide course panel" : "Show course panel"} <kbd className="ml-1 font-mono">[</kbd>
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        className="mr-2 hidden text-[15px] font-semibold tracking-tight sm:inline"
        onClick={() => navigate("/")}
        aria-label="Go to home"
      >
        UniHelperProMax
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2">{toolbar}</div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {actions.map(({ id, component: C }) => (
          <C key={id} />
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Account menu">
              <UserCircle size={22} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{me?.username}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {accountItems
              .filter((item) => !item.ownerOnly || me?.role === "owner")
              .map((item) => (
                <DropdownMenuItem key={item.id} onSelect={() => item.onSelect(navigate)}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            {accountItems.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={() =>
                logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) })
              }
            >
              <SignOut size={16} /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
