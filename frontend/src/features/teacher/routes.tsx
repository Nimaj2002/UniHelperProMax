/**
 * 022 wiring: the session panel's AI Teacher section, and its rail item's activity — a teacher
 * reply being generated or a new one nobody has seen (runs themselves are 014's).
 */
import { useParams } from "react-router";
import { registerActivitySignal } from "@/app/shell/registry";
import { useGenerating, useUnseenHere } from "@/features/chat/runStore";
import { registerTeacherSection } from "@/features/sessions/workspace-panels";
import { TeacherSection, TeacherSectionActions } from "./TeacherSection";

registerTeacherSection({ component: TeacherSection, headerActions: TeacherSectionActions });
registerActivitySignal({
  id: "teacher",
  kind: "answer",
  teacher: true,
  description: "teacher reply being generated",
  priority: 12,
  useActive: () => {
    const { sessionKey } = useParams();
    return useGenerating(sessionKey, true) && !!sessionKey;
  },
});
registerActivitySignal({
  id: "teacher-unseen",
  kind: "unseen",
  teacher: true,
  description: "new teacher reply",
  priority: 13,
  useActive: () => {
    const { sessionKey } = useParams();
    return useUnseenHere(sessionKey, true) && !!sessionKey;
  },
});

export const routes = [];
