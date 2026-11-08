/**
 * 024: every demo request handler, in matching order (contracts/demo-mode.md). Importing a
 * group module also registers its store slice (store.ts `registerSlice`).
 */
import type { HttpHandler } from "msw";
import { handlers as bootstrap } from "./bootstrap";
import { handlers as calendar } from "./calendar";
import { handlers as chat } from "./chat";
import { handlers as documents } from "./documents";
import { handlers as exportsHandlers } from "./exports";
import { handlers as fallback } from "./fallback";
import { handlers as notes } from "./notes";
import { handlers as recordings } from "./recordings";
import { handlers as settings } from "./settings";
import { handlers as tasks } from "./tasks";
import { handlers as teacher } from "./teacher";
import { handlers as themes } from "./themes";
import { handlers as time } from "./time";
import { handlers as transcription } from "./transcription";
import { handlers as unavailable } from "./unavailable";

export const handlers: HttpHandler[] = [
  ...bootstrap,
  ...unavailable, // before the groups, so e.g. POST /sessions/{key}/recordings is never answered by a group
  ...calendar,
  ...notes,
  ...documents,
  ...recordings,
  ...transcription,
  ...chat,
  ...teacher,
  ...tasks,
  ...time,
  ...themes,
  ...settings,
  ...exportsHandlers,
  ...fallback, // must stay last
];
