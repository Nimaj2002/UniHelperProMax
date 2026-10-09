export const PROTECTED_MESSAGE =
  "This PDF is password-protected and can't be opened in the app. You can open it outside the app from the session's documents folder.";

/** A message in the reader's page area (loading, protected, missing, unreadable). */
export function ReaderMessage({ children, tone = "muted" }: { children: string; tone?: "muted" | "danger" }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <p role={tone === "danger" ? "alert" : "status"} className={tone === "danger" ? "max-w-md text-sm text-danger" : "max-w-md text-sm text-muted-foreground"}>
        {children}
      </p>
    </div>
  );
}
