import { stepsWidget } from "../../../../core/modules/agent-widgets/steps/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Steps from "./ui/Steps.vue";

export const steps: WidgetEntry = { definition: stepsWidget, component: Steps };
