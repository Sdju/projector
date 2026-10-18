import { statWidget } from "../../../../core/modules/agent-widgets/stat/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Stat from "./ui/Stat.vue";

export const stat: WidgetEntry = { definition: statWidget, component: Stat };
