/** Feature 007 wiring: the Documents section in the session's side panel and upload results. */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { registerGlobalHost } from "@/app/shell/registry";
import { announceBatch } from "@/features/imports/routes";
import { registerSidePanelSection } from "@/features/sessions/workspace-panels";
import { documentsKey } from "./api";
import { DocumentList } from "./DocumentList";
import "./leaveGuards";
import { documentQueue } from "./queue";

function DocumentUploadLifecycle() {
  const qc = useQueryClient();
  useEffect(() => {
    const q = documentQueue();
    q.onUploaded = (sessionKey) => {
      void qc.invalidateQueries({ queryKey: documentsKey(sessionKey) });
    };
    q.onBatchSettled = (_sessionKey, results) => announceBatch(results);
    return () => {
      q.onUploaded = undefined;
      q.onBatchSettled = undefined;
    };
  }, [qc]);
  return null;
}

registerSidePanelSection({ id: "documents", component: DocumentList });
registerGlobalHost({ id: "document-uploads", component: DocumentUploadLifecycle });

export const routes = [];
