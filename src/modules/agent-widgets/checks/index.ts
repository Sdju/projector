import { checksWidget } from "../../../../core/modules/agent-widgets/checks/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Checks from "./ui/Checks.vue";

export const checks: WidgetEntry = { definition: checksWidget, component: Checks };
