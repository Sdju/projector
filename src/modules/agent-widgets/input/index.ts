import { inputWidget } from "../../../../core/modules/agent-widgets/input/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Input from "./ui/Input.vue";

export const input: WidgetEntry = { definition: inputWidget, component: Input };
