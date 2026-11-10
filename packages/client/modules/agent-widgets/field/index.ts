import { fieldWidget } from "@ai-projector/core/modules/agent-widgets/field/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Field from "./ui/Field.vue";

export const field: WidgetEntry = { definition: fieldWidget, component: Field };
