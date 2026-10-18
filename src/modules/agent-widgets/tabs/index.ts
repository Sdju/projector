import { tabsWidget } from "../../../../core/modules/agent-widgets/tabs/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Tabs from "./ui/Tabs.vue";

export const tabs: WidgetEntry = { definition: tabsWidget, component: Tabs };
