import { sliderWidget } from "../../../../core/modules/agent-widgets/slider/index.ts";
import type { WidgetEntry } from "../../widget-runtime/index.ts";
import Slider from "./ui/Slider.vue";

export const slider: WidgetEntry = { definition: sliderWidget, component: Slider };
