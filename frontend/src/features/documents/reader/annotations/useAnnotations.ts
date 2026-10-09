/**
 * One open document's annotations (007 US6): the device queue, the model, the server's set with
 * unsent operations on top, the save state and conflict notices. The queue lives as long as the
 * document's tab; on close it sends what it can and anything left stays on the device.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { fetchAnnotations, postAnnotationOps } from "../../api";
import { AnnotationModel } from "./model";
import { OpQueue, opStore } from "./opQueue";
import { registerQueue } from "./registry";
import type { SaveStatus } from "./saveState";
import { CONFLICT_NOTICE } from "./tools";

const NOTICES: Record<string, string> = {
  unreadable_file_moved: "The annotations file couldn't be read, so it was kept next to the PDF under a new name and a new one was started.",
  too_many_annotations: "This document has too many annotations to save more.",
  validation_failed: "An annotation couldn't be saved.",
  not_found: "This document no longer exists, so its annotations can't be saved.",
};

interface Loaded {
  model: AnnotationModel;
  queue: OpQueue;
}

const noop = () => () => {};

export function useAnnotations(documentId: string) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    let model: AnnotationModel | null = null;
    const queue = new OpQueue({
      documentId,
      store: opStore(),
      send: (id, ops) => postAnnotationOps(id, ops),
      onResults: (results) => model?.applyResults(results),
      onNotice: (n) => toast.warning(NOTICES[n] ?? "Some annotations couldn't be saved."),
    });
    model = new AnnotationModel({
      queue,
      onConflict: (kind) => toast.info(kind === "kept_both" ? CONFLICT_NOTICE : "This annotation was changed in another window, so it was kept."),
    });
    const unregister = registerQueue(documentId, queue);
    Promise.all([fetchAnnotations(documentId), queue.restore()]).then(
      ([server, pending]) => {
        if (!live || !model) return;
        model.load(server.annotations, pending);
        setLoaded({ model, queue });
        if (!queue.persistent) toast.warning("This browser can't keep unsaved annotations if the page closes; they are saved within seconds while online.");
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      unregister();
      setLoaded(null);
      void queue.flush().finally(() => queue.dispose());
    };
  }, [documentId]);

  const status: SaveStatus = useSyncExternalStore(loaded?.queue.subscribe ?? noop, () => loaded?.queue.status ?? "saved");
  useSyncExternalStore(loaded?.model.subscribe ?? noop, () => loaded?.model.version ?? 0);
  return { model: loaded?.model ?? null, ready: loaded !== null, failed, status };
}
