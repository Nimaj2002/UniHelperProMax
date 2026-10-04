import { NotePencil } from "@phosphor-icons/react";
import { lazy, Suspense } from "react";
import { useNavigate, type RouteObject } from "react-router";
import { Button } from "@/components/ui/button";
import { registerSessionAction, type SessionActionProps } from "@/features/classes/session-actions";
import { workspacePath } from "./SessionTimeline";

// CodeMirror only loads when a workspace is opened
const WorkspacePage = lazy(() => import("./WorkspacePage").then((m) => ({ default: m.WorkspacePage })));

function OpenNotesAction({ session }: SessionActionProps) {
  const navigate = useNavigate();
  return (
    <Button size="sm" onClick={() => navigate(workspacePath(session.courseId, session.key))}>
      <NotePencil size={14} aria-hidden /> Open notes
    </Button>
  );
}

registerSessionAction({ id: "open-notes", component: OpenNotesAction, priority: 0 });

export const routes: RouteObject[] = [
  {
    path: "courses/:courseId/sessions/:sessionKey",
    element: (
      <Suspense fallback={<p role="status" className="p-8 text-sm text-muted-foreground">Opening workspace…</p>}>
        <WorkspacePage />
      </Suspense>
    ),
  },
];
