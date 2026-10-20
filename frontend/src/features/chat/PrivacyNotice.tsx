/**
 * 014 FR-040: before the first message to a Remote endpoint, say where messages go. Send
 * acknowledges it once for that endpoint, then sends.
 */
import { useState } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAckPrivacy, type AiEndpoint } from "@/features/settings/ai/api";
import { hostOf } from "./models";

interface Props {
  endpoint: AiEndpoint | null;
  /** After the acknowledgement was saved: send the message. */
  onConfirmed: () => void;
  onCancel: () => void;
}

export function PrivacyNotice({ endpoint, onConfirmed, onCancel }: Props) {
  const ack = useAckPrivacy();
  const [error, setError] = useState<string>();
  return (
    <AlertDialog open={!!endpoint} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Send to a remote endpoint?</AlertDialogTitle>
          <AlertDialogDescription>
            Messages and attachments will be sent to {hostOf(endpoint?.baseUrl)}, the address you set up for {endpoint?.name}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            disabled={ack.isPending}
            onClick={() => {
              if (!endpoint) return;
              setError(undefined);
              ack.mutate(endpoint.id, { onSuccess: onConfirmed, onError: () => setError("Couldn't save that. Please retry.") });
            }}
          >
            Send
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
