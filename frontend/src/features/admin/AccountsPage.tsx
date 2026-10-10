import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { PageFrame } from "@/app/shell/PageFrame";
import { toast } from "sonner";
import { Field } from "@/components/form/Field";
import { FormError } from "@/components/form/FormError";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMe } from "@/features/auth/api";
import { isApiError } from "@/lib/api";
import { useAccounts, useCreateAccount, useDeleteAccount, useResetPassword, useSetDisabled, type Account } from "./api";

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

function CreateAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateAccount();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!USERNAME_RE.test(username)) errs.username = "Use 3–32 lowercase letters, digits, dots, dashes or underscores.";
    if (password.length < 10) errs.password = "Use at least 10 characters.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    create.mutate({ username, password }, {
      onSuccess: () => {
        toast.success(`Account “${username}” created. They'll choose their own password at first sign-in.`);
        setUsername(""); setPassword(""); onOpenChange(false);
      },
      onError: (err) => setErrors(isApiError(err)
        ? { username: err.fieldMessage("/username") ?? "", password: err.fieldMessage("/password") ?? "", form: err.errors.length ? "" : err.title }
        : { form: "Couldn't create the account." }),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>Give the person a username and a temporary password. They must change it when they first sign in.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <FormError message={errors.form || undefined} />
          <Field label="Username" error={errors.username || undefined}>
            <Input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value.trim().toLowerCase())} />
          </Field>
          <Field label="Temporary password" error={errors.password || undefined} hint="At least 10 characters">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>Create account</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const reset = useResetPassword();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password for {account?.username}</DialogTitle>
          <DialogDescription>They'll be signed out everywhere and must choose a new password at next sign-in.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length < 10) return setError("Use at least 10 characters.");
            reset.mutate({ id: account!.id, newPassword: password }, {
              onSuccess: () => { toast.success("Password reset"); setPassword(""); onClose(); },
              onError: (err) => setError(isApiError(err) ? (err.errors[0]?.message ?? err.title) : "Couldn't reset the password."),
            });
          }}
        >
          <Field label="Temporary password" error={error}>
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={reset.isPending}>Reset password</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AccountsPage() {
  const { data: me } = useMe();
  const accounts = useAccounts();
  const setDisabled = useSetDisabled();
  const del = useDeleteAccount();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  if (me && me.role !== "owner") return <Navigate to="/calendar" replace />;

  return (
    <PageFrame>
    <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
          <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
            Each account's courses, notes and recordings are private. As the owner you manage accounts only.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>New account</Button>
      </div>
      {accounts.isError && <p role="alert" className="mt-6 text-sm text-danger">Couldn't load accounts.</p>}
      <table className="mt-8 w-full text-left text-sm">
        <caption className="sr-only">Accounts on this installation</caption>
        <thead className="border-b border-divider text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 font-medium">Username</th>
            <th scope="col" className="py-2 font-medium">Status</th>
            <th scope="col" className="py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {accounts.data?.map((a) => (
            <tr key={a.id}>
              <th scope="row" className="py-3 font-medium">
                {a.username} {a.role === "owner" && <Badge variant="secondary" className="ml-2">Owner</Badge>}
              </th>
              <td className="py-3 text-muted-foreground">
                {a.disabled ? "Disabled" : a.mustChangePassword ? "Must change password" : "Active"}
              </td>
              <td className="py-3">
                {a.role !== "owner" && (
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setResetting(a)} aria-label={`Reset password for ${a.username}`}>
                      Reset password
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${a.disabled ? "Enable" : "Disable"} ${a.username}`}
                      onClick={() => setDisabled.mutate({ id: a.id, disabled: !a.disabled })}
                    >
                      {a.disabled ? "Enable" : "Disable"}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(a)} aria-label={`Delete ${a.username}`}>
                      Delete
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <CreateAccountDialog open={creating} onOpenChange={setCreating} />
      <ResetPasswordDialog account={resetting} onClose={() => setResetting(null)} />
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              The account and its schedule are removed from the app. Their notes and recordings stay on disk in the
              folder “{deleting?.username}” inside the data folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleting &&
                del.mutate(deleting.id, {
                  onSuccess: (r) => toast.success(`Account deleted. Files kept in “${r.keptFolder}”.`),
                  onError: () => toast.error("Couldn't delete the account."),
                })
              }
            >
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </PageFrame>
  );
}
