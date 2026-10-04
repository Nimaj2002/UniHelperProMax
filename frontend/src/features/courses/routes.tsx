import type { RouteObject } from "react-router";
import { registerCoursePanel } from "@/app/shell/registry";
import { CoursePage } from "./CoursePage";
import { CoursePanel } from "./CoursePanel";

registerCoursePanel({ id: "courses", component: CoursePanel });

export const routes: RouteObject[] = [{ path: "courses/:courseId", element: <CoursePage /> }];
