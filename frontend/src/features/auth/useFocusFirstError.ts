import { useEffect, type RefObject } from "react";

/** After a failed submit, move focus to the first invalid field (or the form alert). */
export function useFocusFirstError(formRef: RefObject<HTMLFormElement | null>, trigger: unknown) {
  useEffect(() => {
    if (!trigger || !formRef.current) return;
    const target =
      formRef.current.querySelector<HTMLElement>("[aria-invalid='true']") ??
      formRef.current.querySelector<HTMLElement>("[role='alert']");
    target?.focus();
  }, [trigger, formRef]);
}
