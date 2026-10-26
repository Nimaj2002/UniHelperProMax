import { SignOut, UserCircle } from "@phosphor-icons/react";
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
import { useIsDesktop, useLogout, useMe } from "@/features/auth/api";
import { signOutAllowed, useAccountMenuItems } from "./registry";

/**
 * The account menu at the bottom of the side panel (labelled) and of the closed rail (icon):
 * who is signed in, the registered account items, and Sign out (guarded, e.g. while recording).
 */
export function AccountMenu({ variant = "full" }: { variant?: "full" | "icon" }) {
  const accountItems = useAccountMenuItems();
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const items = accountItems.filter((item) => (!item.ownerOnly || me?.role === "owner") && !(desktop && item.webOnly));

  const trigger =
    variant === "icon" ? (
      <Button variant="ghost" size="icon" className="size-8" aria-label="Account menu">
        <UserCircle size={20} />
      </Button>
    ) : (
      <Button variant="ghost" size="sm" className="min-w-0 justify-start gap-2 px-2 font-normal" aria-label="Account menu">
        <UserCircle size={18} aria-hidden />
        <span className="truncate">Account</span>
      </Button>
    );

  return (
    <DropdownMenu>
      {variant === "icon" ? (
        // the rail's icon-only button explains itself on hover and focus
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Account{me ? ` · ${me.username}` : ""}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent side={variant === "icon" ? "right" : "top"} align={variant === "icon" ? "end" : "start"} className="min-w-52">
        {!desktop && (
          <>
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{me?.username}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {items.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => item.onSelect(navigate)}>
            {item.label}
          </DropdownMenuItem>
        ))}
        {!desktop && items.length > 0 && <DropdownMenuSeparator />}
        {!desktop && (
          <DropdownMenuItem
            onSelect={() => {
              const signOut = () => logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) });
              if (signOutAllowed(signOut)) signOut();
            }}
          >
            <SignOut size={16} /> Sign out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
