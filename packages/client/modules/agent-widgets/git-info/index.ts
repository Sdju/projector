import { gitInfoWidget } from "@projector-ai/core/modules/agent-widgets/git-info/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import GitInfo from "./ui/GitInfo.vue";

export const gitInfo: WidgetEntry = { definition: gitInfoWidget, component: GitInfo };
