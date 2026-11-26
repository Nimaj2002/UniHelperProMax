import { Outlet } from "react-router";
import { useUiMode } from "@/app/uiMode";
import { HomePage } from "./HomePage";
import { SimpleCalendar } from "./SimpleHome";

/** The home page with the calendar's overlay routes (/classes/new, /sessions/:key…) on top. 026: Simple shows the calendar alone. */
export function HomeLayout() {
  const { mode } = useUiMode();
  return (
    <>
      {mode === "simple" ? <SimpleCalendar /> : <HomePage />}
      <Outlet />
    </>
  );
}
