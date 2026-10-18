import { rowWidget } from "../../../../core/modules/agent-widgets/row/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Row from "./ui/Row.vue";

export const row: WidgetEntry = { definition: rowWidget, component: Row };
