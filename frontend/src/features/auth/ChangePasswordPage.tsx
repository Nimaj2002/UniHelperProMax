import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Field } from "@/components/form/Field";
import { FormError } from "@/components/form/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, isApiError } from "@/lib/api";
import { meKey, useMe, type Me } from "./api";
import { useFocusFirstError } from "./useFocusFirstError";

export function ChangePasswordPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useFocusFirstError(formRef, attempt);
  const forced = !!me?.mustChangePassword;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!current) errs.current = "Enter your current password.";
    if (next.length < 10) errs.next = "Use at least 10 characters.";
    else if (me && next === me.username) errs.next = "The password can't be the same as the username.";
    if (confirm !== next) errs.confirm = "The passwords don't match.";
    setErrors(errs);
    if (Object.keys(errs).length) return setAttempt((a) => a + 1);
    setPending(true);
    try {
      await apiFetch<void>("/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      qc.setQueryData<Me | null>(meKey, (m) => (m ? { ...m, mustChangePassword: false } : m));
      // anything fetched while the password change was required failed with 403: refetch
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== meKey[0] });
      toast.success("Password changed");
      navigate("/calendar", { replace: true });
    } catch (err) {
      if (isApiError(err, "invalid_credentials")) setErrors({ current: "That isn't your current password." });
      else if (isApiError(err)) setErrors({ next: err.fieldMessage("/password") ?? err.fieldMessage("/newPassword") ?? "", form: err.errors.length ? "" : err.title });
      else setErrors({ form: "Couldn't change the password. Please retry." });
      setAttempt((a) => a + 1);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{forced ? "Choose a new password" : "Change password"}</h1>
      {forced && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Your password was set by the owner. Choose your own password to continue.
        </p>
      )}
      <form ref={formRef} onSubmit={submit} noValidate className="mt-8 grid gap-5">
        <FormError message={errors.form || undefined} />
        <Field label="Current password" error={errors.current || undefined}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" error={errors.next || undefined} hint="At least 10 characters">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm || undefined}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          {!forced && <Button type="button" variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>}
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Change password"}</Button>
        </div>
      </form>
    </div>
  );
}
