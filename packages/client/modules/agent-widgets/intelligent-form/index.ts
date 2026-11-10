import { intelligentFormWidget } from "@ai-projector/core/modules/agent-widgets/intelligent-form/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import IntelligentForm from "./ui/IntelligentForm.vue";

export const intelligentForm: WidgetEntry = {
  definition: intelligentFormWidget,
  component: IntelligentForm,
};
