import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type Schemas } from "@/lib/api";
import { recordingsKey } from "@/features/recordings/api";

export type MediaClassGroup = Schemas["MediaClassGroup"];
export type MediaSession = Schemas["MediaSession"];
export type MediaRecording = Schemas["MediaRecording"];
export type Peaks = Schemas["Peaks"];
export type TrimResult = Schemas["TrimResult"];

export const mediaTreeKey = ["media-tree"] as const;
const enc = encodeURIComponent;

/** Every recording grouped class → session: the Recordings browser's data. */
export function useMediaTree() {
  return useQuery({
    queryKey: mediaTreeKey,
    queryFn: () => apiFetch<MediaClassGroup[]>("/media/recordings"),
  });
}

/** Waveform peaks, fetched as soon as the page knows the id (not after the recordings list). */
export const peaksQuery = (recordingId: string, buckets = 2000) =>
  queryOptions({
    queryKey: ["media-peaks", recordingId, buckets],
    queryFn: () => apiFetch<Peaks>(`/recordings/${enc(recordingId)}/peaks`, { query: { buckets } }),
    staleTime: Infinity,
  });

export const usePeaks = (recordingId: string) => useQuery(peaksQuery(recordingId));

export interface TrimInput {
  recordingId: string;
  sessionKey: string;
  version: number;
  /** The windows to keep (025 FR-006a–c). */
  ranges: { startMs: number; endMs: number }[];
  mode: "new" | "overwrite";
  name?: string;
  /** With several windows: one merged recording, or one per window (new only). */
  combine?: "merge" | "separate";
}

/** Save the kept range as a new recording or over the source (overwrite sends If-Match). */
export function useTrim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: TrimInput) =>
      apiFetch<TrimResult>(`/recordings/${enc(i.recordingId)}/trim`, {
        method: "POST",
        body: { ranges: i.ranges, mode: i.mode, name: i.name, combine: i.combine },
        version: i.mode === "overwrite" ? i.version : undefined,
      }),
    onSuccess: (_r, i) => {
      void qc.invalidateQueries({ queryKey: mediaTreeKey });
      if (i.mode === "overwrite") void qc.invalidateQueries({ queryKey: ["media-peaks", i.recordingId] });
      void qc.invalidateQueries({ queryKey: recordingsKey(i.sessionKey) });
      void qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
}
