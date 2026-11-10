import { formWidget } from "@ai-projector/core/modules/agent-widgets/form/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Form from "./ui/Form.vue";

export const form: WidgetEntry = { definition: formWidget, component: Form };
