import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, isApiError, type Schemas } from "@/lib/api";

export type Me = Schemas["Me"];

export const meKey = ["me"] as const;
export const setupStatusKey = ["setup-status"] as const;

export function useSetupStatus() {
  return useQuery({
    queryKey: setupStatusKey,
    queryFn: () => apiFetch<Schemas["SetupStatus"]>("/setup/status"),
    staleTime: Infinity,
  });
}

/** 015: the single-user desktop app, which has no sign-in, accounts or passwords. */
export function useIsDesktop(): boolean {
  return useSetupStatus().data?.mode === "desktop";
}

/** Current user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await apiFetch<Me>("/auth/me");
      } catch (err) {
        if (isApiError(err, "unauthorized")) return null;
        if (isApiError(err, "password_change_required")) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useCreateOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      apiFetch<Me>("/setup/owner", { method: "POST", body: { ...body, timezone: browserTimeZone() } }),
    onSuccess: (me) => {
      qc.setQueryData(setupStatusKey, { needsOwner: false });
      qc.setQueryData(meKey, me);
    },
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      apiFetch<Me>("/auth/login", { method: "POST", body }),
    onSuccess: (me) => qc.setQueryData(meKey, me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>("/auth/logout", { method: "POST" }),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(meKey, null);
    },
  });
}
