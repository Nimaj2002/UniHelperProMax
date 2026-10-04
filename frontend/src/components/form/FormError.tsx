import { WarningCircle } from "@phosphor-icons/react";

export function FormError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <div
      id={id}
      role="alert"
      tabIndex={-1}
      className="flex items-start gap-2 rounded-md border border-danger/40 bg-surface-sunken px-3 py-2 text-sm text-danger"
    >
      <WarningCircle size={18} className="mt-px shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
