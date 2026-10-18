import { barsWidget } from "../../../../core/modules/agent-widgets/bars/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Bars from "./ui/Bars.vue";

export const bars: WidgetEntry = { definition: barsWidget, component: Bars };
