import { Plus } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";

export function NewClassButton() {
  const navigate = useNavigate();
  return (
    <Button size="sm" onClick={() => navigate("/classes/new")} aria-keyshortcuts="n">
      <Plus size={16} weight="bold" aria-hidden />
      <span className="hidden sm:inline">New class</span>
      <span className="sr-only sm:hidden">New class</span>
    </Button>
  );
}
