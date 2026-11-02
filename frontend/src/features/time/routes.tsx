/** Time tracking (020): the floating timer pill and the always-mounted host. */
import { registerActivity, registerGlobalHost } from "@/app/shell/registry";
import { registerWorkspacePanel } from "@/features/sessions/workspace-panels";
import { SessionTime } from "./SessionTime";
import { TimeHost } from "./TimeHost";
import { TimeBar } from "./TimerPill";

// after the recording pill (priority 0), so "two indicators, stacked" puts the recording on top
registerActivity({ id: "time-bar", component: TimeBar, priority: 0.5 });
registerGlobalHost({ id: "time-host", component: TimeHost });
registerWorkspacePanel({ id: "time", title: "Time tracked", component: SessionTime });
