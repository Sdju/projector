import { defineWidget } from "../../widget-catalog/index.ts";

export const donutWidget = defineWidget({
  name: "Donut",
  group: "data",
  summary: "кольцо с долями и легендой",
  props: {
    items: { type: "array", description: "[{label, value}]", required: true },
    center: { type: "string", description: "текст в центре" },
  },
  example: "<Donut center=\"100%\" :items=\"[{label:'A',value:60},{label:'B',value:40}]\" />",
});
