import type { RouteObject } from "react-router";
import { registerCoursePanel } from "@/app/shell/registry";
import { CoursePage } from "./CoursePage";
import { CoursePanel, CourseSearch } from "./CoursePanel";

registerCoursePanel({ id: "courses", component: CoursePanel, search: CourseSearch });

export const routes: RouteObject[] = [{ path: "courses/:courseId", element: <CoursePage /> }];
