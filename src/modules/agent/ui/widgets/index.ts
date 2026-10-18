import type { Component } from "vue";
import Bars from "./Bars.vue";
import Button from "./Button.vue";
import Card from "./Card.vue";
import Checks from "./Checks.vue";
import Columns from "./Columns.vue";
import Donut from "./Donut.vue";
import Form from "./Form.vue";
import Input from "./Input.vue";
import Line from "./Line.vue";
import Row from "./Row.vue";
import Slider from "./Slider.vue";
import Stat from "./Stat.vue";
import Steps from "./Steps.vue";
import Tab from "./Tab.vue";
import Tabs from "./Tabs.vue";

/** Components a message may use as `<Name …>`. Only these names are parsed as components. */
export const widgetComponents: Record<string, Component> = {
  Card,
  Button,
  Bars,
  Checks,
  Columns,
  Donut,
  Form,
  Input,
  Line,
  Row,
  Slider,
  Stat,
  Steps,
  Tab,
  Tabs,
};

export const isWidgetName = (name: string) => Object.hasOwn(widgetComponents, name);
