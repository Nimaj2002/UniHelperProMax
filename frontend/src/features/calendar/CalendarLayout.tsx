import { Outlet } from "react-router";
import { CalendarPage } from "./CalendarPage";

/** Calendar with overlay routes (/classes/new, /sessions/:sessionKey) rendered on top. */
export function CalendarLayout() {
  return (
    <>
      <CalendarPage />
      <Outlet />
    </>
  );
}
