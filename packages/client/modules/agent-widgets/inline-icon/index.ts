import { inlineIconWidget } from "@ai-projector/core/modules/agent-widgets/inline-icon/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import InlineIcon from "./ui/InlineIcon.vue";

export const inlineIcon: WidgetEntry = { definition: inlineIconWidget, component: InlineIcon };
