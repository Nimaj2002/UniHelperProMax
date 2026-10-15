/** 012 wiring outside the home page: the course's Tasks in a class session's side card (R17). */
import { useSession } from "@/features/classes/api";
import { registerSidePanelSection, type SidePanelSectionProps } from "@/features/sessions/workspace-panels";
import { CourseTasks } from "./CourseTasks";

function SessionCourseTasks({ sessionKey }: SidePanelSectionProps) {
  const session = useSession(sessionKey);
  const courseId = session.data?.courseId;
  if (!courseId) return null;
  return <CourseTasks courseId={courseId} courseName={session.data?.courseName ?? undefined} variant="side" />;
}

registerSidePanelSection({
  id: "course-tasks",
  title: "Tasks",
  component: SessionCourseTasks,
  when: (s) => s.courseId !== null,
});
