import type { Component } from "vue";
import UiButton from "../../../../common/ui/UiButton.vue";
import UiCard from "../../../../common/ui/UiCard.vue";
import Bars from "./Bars.vue";
import Checks from "./Checks.vue";
import Donut from "./Donut.vue";
import Input from "./Input.vue";
import Line from "./Line.vue";
import Row from "./Row.vue";
import Slider from "./Slider.vue";
import Stat from "./Stat.vue";
import Steps from "./Steps.vue";
import Tabs from "./Tabs.vue";

/** Components a message may use as `<Name …>`. Only these names are parsed as components. */
export const widgetComponents: Record<string, Component> = {
  Card: UiCard,
  Button: UiButton,
  Bars,
  Checks,
  Donut,
  Input,
  Line,
  Row,
  Slider,
  Stat,
  Steps,
  Tabs,
};

export const isWidgetName = (name: string) => Object.hasOwn(widgetComponents, name);
