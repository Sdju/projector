import { defineWidget } from "../../widget-catalog/index.ts";

export const barsWidget = defineWidget({
  name: "Bars",
  group: "data",
  summary: "горизонтальные столбцы",
  props: {
    items: { type: "array", description: "[{label, value}]", required: true },
    unit: { type: "string", description: "единица после значения" },
  },
  example: "<Bars unit=\" ₽\" :items=\"[{label:'A',value:120},{label:'B',value:80}]\" />",
});
