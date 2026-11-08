/** 023 wiring: the tour host (auto-start, overlay) and the Yuii button in the panel footer. */
import { registerGlobalHost, registerPanelAction } from "@/app/shell/registry";
import { TourButton } from "./TourButton";
import { TourHost } from "./TourHost";

registerGlobalHost({ id: "tour", component: TourHost });
registerPanelAction({ id: "tour", slot: "footer", component: TourButton, priority: 5 });
