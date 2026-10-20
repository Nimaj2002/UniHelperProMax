/**
 * 014 US8 FR-053: a PDF for a model that can't read PDF documents — offer to send the PDF's
 * extracted text instead, or say clearly that the PDF has no text (for example a scan).
 */
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface PdfChoice {
  title: string;
  model: string;
  /** False: a scan or another PDF without text. */
  hasText: boolean;
}

interface Props {
  choice: PdfChoice | null;
  onText: () => void;
  onRemove: () => void;
  onKeep: () => void;
}

export function PdfChoiceDialog({ choice, onText, onRemove, onKeep }: Props) {
  return (
    <AlertDialog open={!!choice} onOpenChange={(o) => !o && onKeep()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{choice?.model} can't read PDF documents</AlertDialogTitle>
          <AlertDialogDescription>
            {choice?.hasText
              ? `Send the text of “${choice.title}” instead? Pictures and layout in the PDF aren't sent.`
              : `This PDF has no text (for example a scan), so “${choice?.title}” can't be sent to this model. Choose a model that accepts PDFs, or remove it.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {choice?.hasText ? (
            <>
              <AlertDialogCancel onClick={onRemove}>Remove</AlertDialogCancel>
              <AlertDialogAction onClick={onText}>Send the PDF's text instead</AlertDialogAction>
            </>
          ) : (
            <>
              <AlertDialogCancel onClick={onKeep}>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={onRemove}>Remove</AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
