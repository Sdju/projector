import { buttonWidget } from "../../../../core/modules/agent-widgets/button/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Button from "./ui/Button.vue";

export const button: WidgetEntry = { definition: buttonWidget, component: Button };
