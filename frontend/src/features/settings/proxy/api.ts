/** 021: Settings → Proxy — one proxy per user, used by the Transcription and AI "Use proxy" switches. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type Schemas } from "@/lib/api";
import { aiSettingsKey } from "../ai/api";
import { transcriptionSettingsKey } from "../api";

export type ProxySettings = Schemas["ProxySettingsOut"];
export type Proxy = Schemas["ProxyOut"];
export type ProxySave = Schemas["ProxySave"];
export type ProxyTest = Schemas["ProxyTest"];
export type ProxyTestResult = Schemas["ProxyTestResult"];
export type ProxyScheme = Proxy["scheme"];
export type ProxySection = ProxySettings["usedBy"][number];

export const proxyKey = ["settings", "proxy"] as const;

export function useProxy() {
  return useQuery({ queryKey: proxyKey, queryFn: () => apiFetch<ProxySettings>("/settings/proxy") });
}

export function useSaveProxy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ version, body }: { version?: number; body: ProxySave }) =>
      apiFetch<ProxySettings>("/settings/proxy", { method: "PUT", body, version }),
    onSuccess: (next) => qc.setQueryData(proxyKey, next),
  });
}

export function useDeleteProxy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) =>
      apiFetch<Schemas["ProxyDeleted"]>("/settings/proxy", { method: "DELETE", version }),
    onSuccess: () => {
      // the switches that used it are now off
      void qc.invalidateQueries({ queryKey: proxyKey });
      void qc.invalidateQueries({ queryKey: transcriptionSettingsKey });
      void qc.invalidateQueries({ queryKey: aiSettingsKey });
    },
  });
}

/** Never saves anything. */
export function useTestProxy() {
  return useMutation({
    mutationFn: (body: ProxyTest) => apiFetch<ProxyTestResult>("/settings/proxy/test", { method: "POST", body }),
  });
}
