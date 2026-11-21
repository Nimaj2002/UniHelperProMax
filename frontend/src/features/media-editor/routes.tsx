/** 025: the Media Editor page. Loaded lazily: the waveform library is only fetched here. */
import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router";

const MediaEditorPage = lazy(() => import("./MediaEditorPage"));

export const routes: RouteObject[] = [
  {
    path: "media-editor",
    element: (
      <Suspense fallback={null}>
        <MediaEditorPage />
      </Suspense>
    ),
  },
];
