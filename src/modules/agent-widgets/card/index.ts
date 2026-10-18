import { cardWidget } from "../../../../core/modules/agent-widgets/card/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Card from "./ui/Card.vue";

export const card: WidgetEntry = { definition: cardWidget, component: Card };
