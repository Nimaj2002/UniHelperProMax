/** 014 FR-038: the models a chat can use — enabled endpoints, models not hidden. */
import { useMemo } from "react";
import { useAiEndpoints, useAiSettings, type AiEndpoint, type AiModel } from "@/features/settings/ai/api";
import type { ModelRef } from "./api";

export interface ModelChoice {
  endpoint: AiEndpoint;
  model: AiModel;
  ref: ModelRef;
}

export const sameRef = (a: ModelRef | null | undefined, b: ModelRef | null | undefined) =>
  !!a && !!b && a.endpointId === b.endpointId && a.modelId === b.modelId;

export function hostOf(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function usableModels(endpoints: AiEndpoint[] | undefined): ModelChoice[] {
  return (endpoints ?? [])
    .filter((e) => e.enabled)
    .flatMap((endpoint) =>
      endpoint.models.filter((m) => !m.hidden).map((model) => ({ endpoint, model, ref: { endpointId: endpoint.id, modelId: model.id } })),
    );
}

/** Usable models, the default for a new chat (the last model used) and a resolver. */
export function useModels() {
  const endpoints = useAiEndpoints();
  const settings = useAiSettings();
  return useMemo(() => {
    const choices = usableModels(endpoints.data);
    const find = (ref: ModelRef | null | undefined) => (ref ? choices.find((c) => sameRef(c.ref, ref)) : undefined);
    const fallback = find(settings.data?.lastModel) ?? choices[0];
    return {
      loading: endpoints.isPending,
      choices,
      find,
      fallback,
      endpointById: (id: string) => endpoints.data?.find((e) => e.id === id),
      endpointByName: (name: string) => endpoints.data?.find((e) => e.name === name),
    };
  }, [endpoints.data, endpoints.isPending, settings.data?.lastModel]);
}
