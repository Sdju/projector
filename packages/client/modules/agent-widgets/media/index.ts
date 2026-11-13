import { mediaWidget } from "@ai-projector/core/modules/agent-widgets/media/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Media from "./ui/Media.vue";

export const media: WidgetEntry = { definition: mediaWidget, component: Media };
