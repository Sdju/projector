import { chipsWidget } from "@ai-projector/core/modules/agent-widgets/chips/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Chips from "./ui/Chips.vue";

export const chips: WidgetEntry = { definition: chipsWidget, component: Chips };
