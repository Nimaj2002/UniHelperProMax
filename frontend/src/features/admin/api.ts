import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type Schemas } from "@/lib/api";

export type Account = Schemas["Account"];
const key = ["admin-users"] as const;

export function useAccounts() {
  return useQuery({ queryKey: key, queryFn: () => apiFetch<Account[]>("/admin/users") });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: key });
}

export function useCreateAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      apiFetch<Account>("/admin/users", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useSetDisabled() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      apiFetch<Account>(`/admin/users/${id}`, { method: "PATCH", body: { disabled } }),
    onSuccess: invalidate,
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      apiFetch<void>(`/admin/users/${id}/password-reset`, { method: "POST", body: { newPassword } }),
  });
}

export function useDeleteAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ keptFolder: string }>(`/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
