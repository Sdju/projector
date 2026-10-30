import { imageWidget } from "../../../../core/modules/agent-widgets/image/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Image from "./ui/Image.vue";

export const image: WidgetEntry = { definition: imageWidget, component: Image };
