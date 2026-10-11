import { PencilSimple, Trash } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import type { SessionActionProps } from "./session-actions";

// 009: the same routes edit and delete events (the flows branch on `kind`)
export function EditSessionAction({ session }: SessionActionProps) {
  const navigate = useNavigate();
  return (
    <Button size="sm" variant="outline" onClick={() => navigate(`/sessions/${encodeURIComponent(session.key)}/edit`)}>
      <PencilSimple size={14} aria-hidden /> Edit
    </Button>
  );
}

export function DeleteSessionAction({ session }: SessionActionProps) {
  const navigate = useNavigate();
  return (
    <Button size="sm" variant="outline" className="text-danger" onClick={() => navigate(`/sessions/${encodeURIComponent(session.key)}/delete`)}>
      <Trash size={14} aria-hidden /> Delete
    </Button>
  );
}
