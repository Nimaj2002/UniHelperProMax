import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** 019 FR-006: a key another command already uses; reassign takes it from that command. */
export function ConflictDialog({ conflict, onReassign, onCancel }: {
  conflict: { label: string; owner: string; command: string } | null;
  onReassign: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={!!conflict} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{conflict?.label} is already in use</AlertDialogTitle>
          <AlertDialogDescription>
            {conflict?.label} is used by “{conflict?.owner}”. Reassign it to “{conflict?.command}”? “{conflict?.owner}” will have no key there.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onReassign}>Reassign</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
