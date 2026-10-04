import { useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { Field } from "@/components/form/Field";
import { FormError } from "@/components/form/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import { AuthLayout } from "./AuthLayout";
import { useCreateOwner, useSetupStatus } from "./api";
import { useFocusFirstError } from "./useFocusFirstError";

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export function SetupPage() {
  const status = useSetupStatus();
  const create = useCreateOwner();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  useFocusFirstError(formRef, attempt);

  if (status.data && !status.data.needsOwner) return <Navigate to="/login" replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!USERNAME_RE.test(username))
      next.username = "Use 3–32 lowercase letters, digits, dots, dashes or underscores.";
    if (password.length < 10) next.password = "Use at least 10 characters.";
    else if (password === username) next.password = "The password can't be the same as the username.";
    if (confirm !== password) next.confirm = "The passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length) {
      setAttempt((a) => a + 1);
      return;
    }
    create.mutate(
      { username, password },
      {
        onSuccess: () => navigate("/calendar", { replace: true }),
        onError: (err) => {
          if (isApiError(err)) {
            setErrors({
              username: err.fieldMessage("/username") ?? "",
              password: err.fieldMessage("/password") ?? "",
              form: err.errors.length ? "" : err.title,
            });
          } else setErrors({ form: "Something went wrong. Please try again." });
          setAttempt((a) => a + 1);
        },
      },
    );
  };

  return (
    <AuthLayout
      title="Create the owner account"
      subtitle="This is the first account on this installation. The owner can add accounts for other people later."
    >
      <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormError message={errors.form} />
        <Field label="Username" error={errors.username || undefined} hint="Lowercase letters, digits, . _ -">
          <Input
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value.trim().toLowerCase())}
          />
        </Field>
        <Field label="Password" error={errors.password || undefined} hint="At least 10 characters">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" error={errors.confirm || undefined}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" disabled={create.isPending} className="mt-1">
          {create.isPending ? "Creating…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
