import { tabWidget } from "@ai-projector/core/modules/agent-widgets/tab/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Tab from "./ui/Tab.vue";

export const tab: WidgetEntry = { definition: tabWidget, component: Tab };
