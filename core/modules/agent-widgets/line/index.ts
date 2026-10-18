import { defineWidget } from "../../widget-catalog/index.ts";

export const lineWidget = defineWidget({
  name: "Line",
  group: "data",
  summary: "линейный график по меткам оси",
  props: {
    labels: { type: "array", description: "подписи оси X: ['янв','фев']", required: true },
    series: { type: "array", description: "[{name, data:[числа]}] по числу меток", required: true },
    height: { type: "number", description: "высота, по умолчанию 160" },
  },
  example: "<Line :labels=\"['янв','фев']\" :series=\"[{name:'Выручка',data:[10,14]}]\" />",
});
