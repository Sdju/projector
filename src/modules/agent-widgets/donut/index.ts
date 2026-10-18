import { donutWidget } from "../../../../core/modules/agent-widgets/donut/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Donut from "./ui/Donut.vue";

export const donut: WidgetEntry = { definition: donutWidget, component: Donut };
