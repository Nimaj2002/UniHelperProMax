import { useCoursePanel } from "./registry";

export function CoursePanelSlot() {
  const panel = useCoursePanel();
  if (!panel) return null;
  const Panel = panel.component;
  return <Panel />;
}

export function CourseSearchSlot() {
  const Search = useCoursePanel()?.search;
  return Search ? <Search /> : null;
}
