/** 014 US1: Settings → AI — endpoints, styles, Test connection, Refresh and custom instructions. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type Schemas } from "@/lib/api";

export type AiStyle = Schemas["AiStyle"];
export type AiStyleId = AiStyle["id"];
export type AiEndpoint = Schemas["AiEndpointOut"];
export type AiModel = Schemas["AiModelOut"];
export type AiModelInput = Schemas["AiModelInput"];
export type AiCapabilities = Schemas["Capabilities"];
export type AiEndpointCreate = Schemas["AiEndpointCreate"];
export type AiEndpointUpdate = Schemas["AiEndpointUpdate"];
export type AiEndpointTest = Schemas["AiEndpointTest"];
export type AiTestResult = Schemas["AiTestResult"];
export type AiDiscoverResult = Schemas["AiDiscoverResult"];
export type BaseUrlResult = Schemas["BaseUrlResult"];
export type AiSettings = Schemas["AiSettingsOut"];

export const aiEndpointsKey = ["ai-endpoints"] as const;
export const aiStylesKey = ["ai-styles"] as const;
export const aiSettingsKey = ["ai-settings"] as const;

const endpointPath = (id: string) => `/ai/endpoints/${encodeURIComponent(id)}`;

export function useAiStyles() {
  return useQuery({ queryKey: aiStylesKey, queryFn: () => apiFetch<AiStyle[]>("/ai/styles"), staleTime: Infinity });
}

export function useAiEndpoints() {
  return useQuery({ queryKey: aiEndpointsKey, queryFn: () => apiFetch<AiEndpoint[]>("/ai/endpoints") });
}

export function useAiSettings() {
  return useQuery({ queryKey: aiSettingsKey, queryFn: () => apiFetch<AiSettings>("/ai/settings") });
}

export const createEndpoint = (body: AiEndpointCreate) => apiFetch<AiEndpoint>("/ai/endpoints", { method: "POST", body });
export const updateEndpoint = (id: string, version: number, body: AiEndpointUpdate) =>
  apiFetch<AiEndpoint>(endpointPath(id), { method: "PATCH", body, version });
export const deleteEndpoint = (id: string, version: number) => apiFetch<void>(endpointPath(id), { method: "DELETE", version });
/** Never saves anything (FR-017). */
export const testEndpoint = (body: AiEndpointTest) => apiFetch<AiTestResult>("/ai/endpoints/test", { method: "POST", body });
/** Refresh: candidates only, nothing is saved. */
export const discoverModels = (body: AiEndpointTest) =>
  apiFetch<AiDiscoverResult>("/ai/endpoints/models/discover", { method: "POST", body });
export const checkBaseUrl = (body: { style: AiStyleId; baseUrl: string }, signal?: AbortSignal) =>
  apiFetch<BaseUrlResult>("/ai/base-url/check", { method: "POST", body, signal });
export const ackPrivacy = (id: string) => apiFetch<AiEndpoint>(`${endpointPath(id)}/privacy-ack`, { method: "POST" });
export const saveAiSettings = (version: number, body: { customInstructions: string }) =>
  apiFetch<AiSettings>("/ai/settings", { method: "PUT", body, version });

/** Replace one endpoint in the cached list (or append a new one). */
function useStoreEndpoint() {
  const qc = useQueryClient();
  return (ep: AiEndpoint) =>
    qc.setQueryData<AiEndpoint[]>(aiEndpointsKey, (all = []) =>
      all.some((e) => e.id === ep.id) ? all.map((e) => (e.id === ep.id ? ep : e)) : [...all, ep],
    );
}

export function useCreateEndpoint() {
  const store = useStoreEndpoint();
  return useMutation({ mutationFn: createEndpoint, onSuccess: store });
}

export function useUpdateEndpoint() {
  const store = useStoreEndpoint();
  return useMutation({
    mutationFn: ({ id, version, body }: { id: string; version: number; body: AiEndpointUpdate }) => updateEndpoint(id, version, body),
    onSuccess: store,
  });
}

export function useDeleteEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => deleteEndpoint(id, version),
    onSuccess: (_, { id }) => qc.setQueryData<AiEndpoint[]>(aiEndpointsKey, (all = []) => all.filter((e) => e.id !== id)),
  });
}

export function useAckPrivacy() {
  const store = useStoreEndpoint();
  return useMutation({ mutationFn: ackPrivacy, onSuccess: store });
}

export function useTestEndpoint() {
  return useMutation({ mutationFn: testEndpoint });
}

export function useDiscoverModels() {
  return useMutation({ mutationFn: discoverModels });
}

export function useCheckBaseUrl() {
  return useMutation({ mutationFn: (body: { style: AiStyleId; baseUrl: string }) => checkBaseUrl(body) });
}

export function useSaveAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ version, customInstructions }: { version: number; customInstructions: string }) =>
      saveAiSettings(version, { customInstructions }),
    onSuccess: (next) => qc.setQueryData(aiSettingsKey, next),
  });
}
