import { columnsWidget } from "../../../../core/modules/agent-widgets/columns/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Columns from "./ui/Columns.vue";

export const columns: WidgetEntry = { definition: columnsWidget, component: Columns };
