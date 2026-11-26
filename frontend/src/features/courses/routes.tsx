import type { RouteObject } from "react-router";
import { registerCoursePanel } from "@/app/shell/registry";
import { CoursePage } from "./CoursePage";
import { CoursesGridPage } from "./CoursesGridPage";
import { CoursePanel, CourseSearch } from "./CoursePanel";

registerCoursePanel({ id: "courses", component: CoursePanel, search: CourseSearch });

export const routes: RouteObject[] = [
  { path: "courses", element: <CoursesGridPage /> }, // 026: Simple's course boxes (Ultimate redirects to "/")
  { path: "courses/:courseId", element: <CoursePage /> },
];
