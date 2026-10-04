import { useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Field } from "@/components/form/Field";
import { FormError } from "@/components/form/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import { AuthLayout } from "./AuthLayout";
import { useLogin, useMe, useSetupStatus } from "./api";
import { useFocusFirstError } from "./useFocusFirstError";

export function LoginPage() {
  const status = useSetupStatus();
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const formRef = useRef<HTMLFormElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useFocusFirstError(formRef, attempt);

  if (status.data?.needsOwner) return <Navigate to="/setup" replace />;
  if (me.data) return <Navigate to="/calendar" replace />;

  const from = (location.state as { from?: string } | null)?.from ?? "/calendar";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Enter your username and password.");
      setAttempt((a) => a + 1);
      return;
    }
    login.mutate(
      { username, password },
      {
        onSuccess: (user) => navigate(user.mustChangePassword ? "/account/password" : from, { replace: true }),
        onError: (err) => {
          if (isApiError(err, "too_many_attempts")) setError(err.title);
          else if (isApiError(err) && err.status === 0) setError(err.title);
          else setError("Incorrect username or password.");
          setAttempt((a) => a + 1);
        },
      },
    );
  };

  return (
    <AuthLayout title="Sign in">
      <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormError message={error} id="login-error" />
        <Field label="Username">
          <Input
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" disabled={login.isPending} className="mt-1">
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
