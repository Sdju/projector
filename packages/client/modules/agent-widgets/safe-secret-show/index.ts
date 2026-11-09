import { safeSecretShowWidget } from "@projector/core/modules/agent-widgets/safe-secret-show/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import SafeSecretShow from "./ui/SafeSecretShow.vue";

export const safeSecretShow: WidgetEntry = {
  definition: safeSecretShowWidget,
  component: SafeSecretShow,
};
