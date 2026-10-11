import { Navigate, useLocation, useParams } from "react-router";
import { useSession } from "@/features/classes/api";
import { entryWorkspacePath } from "./SessionTimeline";

/** `/workspace/:sessionKey` (009): open the session's workspace under its course, or an event's
 * under its semester, keeping the query (e.g. `?note=`). */
export function WorkspaceRedirect() {
  const { sessionKey = "" } = useParams();
  const { search } = useLocation();
  const session = useSession(sessionKey);
  if (session.data) return <Navigate to={`${entryWorkspacePath(session.data)}${search}`} replace />;
  if (session.isError) return <p role="alert" className="p-8 text-sm text-danger">This session doesn't exist.</p>;
  return <p role="status" className="p-8 text-sm text-muted-foreground">Opening workspace…</p>;
}
