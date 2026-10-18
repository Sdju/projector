import { lineWidget } from "../../../../core/modules/agent-widgets/line/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Line from "./ui/Line.vue";

export const line: WidgetEntry = { definition: lineWidget, component: Line };
