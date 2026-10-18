import { defineWidget } from "../../widget-catalog/index.ts";

export const stepsWidget = defineWidget({
  name: "Steps",
  group: "data",
  summary: "этапы с отметкой готовности",
  props: {
    items: { type: "array", description: "[{title, text?, done?}]", required: true },
  },
  example: "<Steps :items=\"[{title:'Собрать',done:true},{title:'Проверить'}]\" />",
});
