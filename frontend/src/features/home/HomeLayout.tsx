import { Outlet } from "react-router";
import { HomePage } from "./HomePage";

/** The home page with the calendar's overlay routes (/classes/new, /sessions/:key…) on top. */
export function HomeLayout() {
  return (
    <>
      <HomePage />
      <Outlet />
    </>
  );
}
