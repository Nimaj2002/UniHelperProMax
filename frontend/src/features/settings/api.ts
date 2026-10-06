import { useQuery } from "@tanstack/react-query";
import { apiFetch, type Schemas } from "@/lib/api";

export type ProviderSpec = Schemas["ProviderSpec"];
export type ProviderField = Schemas["ProviderField"];
export type TranscriptionSettings = Schemas["TranscriptionSettings"];
export type ProviderSettings = Schemas["ProviderSettings"];
export type ConnectionTestResult = Schemas["ConnectionTestResult"];
export type Theme = Schemas["Theme"];

export const providersKey = ["transcription", "providers"] as const;
export const transcriptionSettingsKey = ["settings", "transcription"] as const;
export const themesKey = ["themes"] as const;

export function useProviders() {
  return useQuery({ queryKey: providersKey, queryFn: () => apiFetch<ProviderSpec[]>("/transcription/providers"), staleTime: Infinity });
}

export function useTranscriptionSettings() {
  return useQuery({ queryKey: transcriptionSettingsKey, queryFn: () => apiFetch<TranscriptionSettings>("/settings/transcription") });
}

export interface SettingsSave {
  activeProviderId: string;
  defaultLanguage: string;
  provider: { providerId: string; values: Record<string, string>; apiKey?: string | null };
}

export const saveTranscriptionSettings = (body: SettingsSave) =>
  apiFetch<TranscriptionSettings>("/settings/transcription", { method: "PUT", body });

export const testConnection = (body: { providerId: string; values: Record<string, string>; apiKey?: string | null; useSavedKey?: boolean }) =>
  apiFetch<ConnectionTestResult>("/settings/transcription/test", { method: "POST", body });

export function useThemes(enabled = true) {
  return useQuery({ queryKey: themesKey, queryFn: () => apiFetch<Theme[]>("/themes"), enabled, staleTime: 60_000 });
}

export type ThemeBody = Pick<Theme, "name" | "keyColors" | "overrides" | "colors" | "lowContrast">;

export const createTheme = (body: ThemeBody & { base: "light" | "dark"; uniqueName?: boolean }) =>
  apiFetch<Theme>("/themes", { method: "POST", body });
export const updateTheme = (id: string, version: number, body: ThemeBody) =>
  apiFetch<Theme>(`/themes/${encodeURIComponent(id)}`, { method: "PUT", body, version });
export const deleteTheme = (id: string, version: number) =>
  apiFetch<void>(`/themes/${encodeURIComponent(id)}`, { method: "DELETE", version });
